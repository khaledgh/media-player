package zipimport

import (
	"archive/zip"
	"context"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

type fakeSink struct {
	next    int64
	folders map[string]int64 // "parent/name" -> id
	files   []string         // "folderID:name:content"
}

func (s *fakeSink) EnsureFolder(_ context.Context, parent int64, name string) (int64, error) {
	key := string(rune('0'+parent)) + "/" + name
	if id, ok := s.folders[key]; ok {
		return id, nil
	}
	s.next++
	s.folders[key] = s.next
	return s.next, nil
}

func (s *fakeSink) ImportFile(_ context.Context, folderID int64, p, name string) error {
	b, err := os.ReadFile(p)
	if err != nil {
		return err
	}
	s.files = append(s.files, string(rune('0'+folderID))+":"+name+":"+string(b))
	return nil
}

func isAudio(n string) bool { return strings.HasSuffix(strings.ToLower(n), ".mp3") }

func writeZip(t *testing.T, files map[string]string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "in.zip")
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(f)
	names := make([]string, 0, len(files))
	for n := range files {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		w, err := zw.Create(n)
		if err != nil {
			t.Fatal(err)
		}
		w.Write([]byte(files[n]))
	}
	zw.Close()
	f.Close()
	return p
}

func TestRunMirrorsDirectoriesAndSkipsJunk(t *testing.T) {
	p := writeZip(t, map[string]string{
		"top.mp3":                   "a",
		"Rock/song1.MP3":            "b",
		"Rock/Live/song2.mp3":       "c",
		"Rock/cover.jpg":            "skip",
		"__MACOSX/Rock/._song1.mp3": "skip",
		"Rock/.hidden.mp3":          "skip",
		"../escape.mp3":             "d",
	})
	sink := &fakeSink{next: 1, folders: map[string]int64{}} // root = 1
	var last [3]int
	errs, err := Run(context.Background(), p, 1, sink, isAudio, func(t, pr, f int) { last = [3]int{t, pr, f} })
	if err != nil || len(errs) != 0 {
		t.Fatalf("Run: %v %v", err, errs)
	}
	if last != [3]int{4, 4, 0} {
		t.Fatalf("progress = %v", last)
	}
	sort.Strings(sink.files)
	want := []string{"1:escape.mp3:d", "1:top.mp3:a", "2:song1.MP3:b", "3:song2.mp3:c"}
	if strings.Join(sink.files, ",") != strings.Join(want, ",") {
		t.Fatalf("files = %v, want %v", sink.files, want)
	}
	if sink.folders["1/Rock"] != 2 || sink.folders["2/Live"] != 3 {
		t.Fatalf("folders = %v", sink.folders)
	}
}

func TestRunRejectsZipWithoutAudio(t *testing.T) {
	p := writeZip(t, map[string]string{"readme.txt": "x"})
	if _, err := Run(context.Background(), p, 1, &fakeSink{folders: map[string]int64{}}, isAudio, nil); err == nil {
		t.Fatal("expected error")
	}
}
