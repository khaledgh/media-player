// Package zipimport extracts audio files from a zip archive into a folder
// tree, mirroring the archive's directories as subfolders.
package zipimport

import (
	"archive/zip"
	"context"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// MaxEntryBytes caps a single extracted file to defend against zip bombs.
const MaxEntryBytes = 1 << 30

// Sink receives folders and files discovered in the archive.
type Sink interface {
	EnsureFolder(ctx context.Context, parentID int64, name string) (int64, error)
	ImportFile(ctx context.Context, folderID int64, localPath, fileName string) error
}

type Progress func(total, processed, failed int)

// Entries lists the audio files in the archive in a stable order.
func Entries(zr *zip.Reader, isAudio func(string) bool) []*zip.File {
	var out []*zip.File
	for _, f := range zr.File {
		name := strings.ReplaceAll(f.Name, "\\", "/")
		if f.FileInfo().IsDir() || strings.HasPrefix(name, "__MACOSX/") || strings.HasPrefix(path.Base(name), ".") {
			continue
		}
		if isAudio(name) {
			out = append(out, f)
		}
	}
	return out
}

// Run imports every audio file in zipPath under root. It keeps going after a
// per-file failure and returns the errors it collected.
func Run(ctx context.Context, zipPath string, root int64, sink Sink, isAudio func(string) bool, progress Progress) ([]error, error) {
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return nil, fmt.Errorf("open zip: %w", err)
	}
	defer zr.Close()

	entries := Entries(&zr.Reader, isAudio)
	if len(entries) == 0 {
		return nil, fmt.Errorf("the zip contains no audio files")
	}
	folders := map[string]int64{"": root} // dir path inside zip -> folder id
	var errs []error
	failed := 0
	if progress != nil {
		progress(len(entries), 0, 0)
	}
	for i, f := range entries {
		if err := ctx.Err(); err != nil {
			return errs, err
		}
		name := strings.ReplaceAll(f.Name, "\\", "/")
		dir, base := path.Split(strings.TrimPrefix(path.Clean("/"+name), "/"))
		dir = strings.TrimSuffix(dir, "/")
		if err := importEntry(ctx, f, dir, base, folders, sink); err != nil {
			failed++
			errs = append(errs, fmt.Errorf("%s: %w", name, err))
		}
		if progress != nil {
			progress(len(entries), i+1, failed)
		}
	}
	return errs, nil
}

func ensureDir(ctx context.Context, dir string, folders map[string]int64, sink Sink) (int64, error) {
	if id, ok := folders[dir]; ok {
		return id, nil
	}
	parentDir, name := path.Split(dir)
	parent, err := ensureDir(ctx, strings.TrimSuffix(parentDir, "/"), folders, sink)
	if err != nil {
		return 0, err
	}
	id, err := sink.EnsureFolder(ctx, parent, name)
	if err != nil {
		return 0, err
	}
	folders[dir] = id
	return id, nil
}

func importEntry(ctx context.Context, f *zip.File, dir, base string, folders map[string]int64, sink Sink) error {
	if f.UncompressedSize64 > MaxEntryBytes {
		return fmt.Errorf("file too large")
	}
	folderID, err := ensureDir(ctx, dir, folders, sink)
	if err != nil {
		return err
	}
	rc, err := f.Open()
	if err != nil {
		return err
	}
	defer rc.Close()
	tmp, err := os.CreateTemp("", "mume-zip-*"+filepath.Ext(base))
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	n, err := io.Copy(tmp, io.LimitReader(rc, MaxEntryBytes+1))
	tmp.Close()
	if err != nil {
		return err
	}
	if n > MaxEntryBytes {
		return fmt.Errorf("file too large")
	}
	return sink.ImportFile(ctx, folderID, tmp.Name(), base)
}
