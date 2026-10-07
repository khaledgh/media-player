// Package library holds the domain logic shared by the API, the CMS,
// the YouTube worker and the zip importer: ingesting audio files,
// folders, folder items and per-user visibility.
package library

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/dhowden/tag"
	"github.com/go-sql-driver/mysql"
	"github.com/tcolgate/mp3"

	"mume/server/internal/db"
	"mume/server/internal/storage"
)

var (
	ErrNotFound  = errors.New("not found")
	ErrForbidden = errors.New("forbidden")
	ErrInvalid   = errors.New("invalid request")
)

var audioMime = map[string]string{
	".mp3":  "audio/mpeg",
	".m4a":  "audio/mp4",
	".aac":  "audio/aac",
	".flac": "audio/flac",
	".ogg":  "audio/ogg",
	".opus": "audio/ogg",
	".wav":  "audio/wav",
}

// IsAudio reports whether name has a supported audio extension.
func IsAudio(name string) bool {
	_, ok := audioMime[strings.ToLower(filepath.Ext(name))]
	return ok
}

type Library struct {
	DB    *sql.DB
	Store storage.Store
}

type Track struct {
	ID         int64  `json:"id"`
	Title      string `json:"title"`
	Artist     string `json:"artist"`
	Album      string `json:"album"`
	DurationMs int    `json:"duration_ms"`
	SizeBytes  int64  `json:"size_bytes"`
	Mime       string `json:"mime"`
	HasCover   bool   `json:"has_cover"`
	Source     string `json:"source"`
	SourceURL  string `json:"source_url,omitempty"`
	Rev        int64  `json:"rev"`
}

type IngestInput struct {
	Path          string // local file to ingest
	FileName      string // original name, used for extension and fallback title
	Source        string // "upload" or "youtube"
	SourceURL     string
	FallbackTitle string
	DurationMs    int
}

// Ingest stores an audio file once (deduplicated by sha256) and returns its track id.
func (l *Library) Ingest(ctx context.Context, in IngestInput) (int64, error) {
	ext := strings.ToLower(filepath.Ext(in.FileName))
	mime, ok := audioMime[ext]
	if !ok {
		return 0, fmt.Errorf("%w: unsupported file type %q", ErrInvalid, ext)
	}
	f, err := os.Open(in.Path)
	if err != nil {
		return 0, err
	}
	defer f.Close()

	h := sha256.New()
	size, err := io.Copy(h, f)
	if err != nil {
		return 0, err
	}
	if size == 0 {
		return 0, fmt.Errorf("%w: empty file", ErrInvalid)
	}
	sum := hex.EncodeToString(h.Sum(nil))

	var existing int64
	err = l.DB.QueryRowContext(ctx, `SELECT id FROM tracks WHERE sha256 = ?`, sum).Scan(&existing)
	if err == nil {
		return existing, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}

	title := strings.TrimSuffix(filepath.Base(in.FileName), filepath.Ext(in.FileName))
	if in.FallbackTitle != "" {
		title = in.FallbackTitle
	}
	var artist, album string
	var cover *tag.Picture
	if _, err := f.Seek(0, io.SeekStart); err == nil {
		if m, err := tag.ReadFrom(f); err == nil {
			if t := strings.TrimSpace(m.Title()); t != "" {
				title = t
			}
			artist = strings.TrimSpace(m.Artist())
			album = strings.TrimSpace(m.Album())
			cover = m.Picture()
		}
	}
	duration := in.DurationMs
	if duration == 0 && ext == ".mp3" {
		if _, err := f.Seek(0, io.SeekStart); err == nil {
			duration = mp3DurationMs(f)
		}
	}

	objectKey := fmt.Sprintf("tracks/%s/%s%s", sum[:2], sum, ext)
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return 0, err
	}
	if err := l.Store.Put(ctx, objectKey, f, size, mime); err != nil {
		return 0, fmt.Errorf("upload audio: %w", err)
	}
	var coverKey sql.NullString
	if cover != nil && len(cover.Data) > 0 {
		cext := "jpg"
		if strings.Contains(cover.MIMEType, "png") {
			cext = "png"
		}
		key := fmt.Sprintf("covers/%s/%s.%s", sum[:2], sum, cext)
		if err := l.Store.Put(ctx, key, bytes.NewReader(cover.Data), int64(len(cover.Data)), "image/"+cext); err == nil {
			coverKey = sql.NullString{String: key, Valid: true}
		}
	}

	var id int64
	err = db.WithTx(ctx, l.DB, func(tx *sql.Tx) error {
		rev, err := db.NextRev(ctx, tx)
		if err != nil {
			return err
		}
		res, err := tx.ExecContext(ctx, `
			INSERT INTO tracks (sha256, object_key, cover_key, title, artist, album, duration_ms, size_bytes, mime, source, source_url, rev)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			sum, objectKey, coverKey, truncate(title, 512), truncate(artist, 512), truncate(album, 512),
			duration, size, mime, sourceOr(in.Source), nullStr(in.SourceURL), rev)
		if err != nil {
			return err
		}
		id, err = res.LastInsertId()
		return err
	})
	var me *mysql.MySQLError
	if errors.As(err, &me) && me.Number == 1062 { // concurrent ingest of the same file
		err = l.DB.QueryRowContext(ctx, `SELECT id FROM tracks WHERE sha256 = ?`, sum).Scan(&id)
	}
	return id, err
}

func mp3DurationMs(r io.Reader) int {
	d := mp3.NewDecoder(r)
	var f mp3.Frame
	skipped := 0
	var total time.Duration
	for {
		if err := d.Decode(&f, &skipped); err != nil {
			break
		}
		total += f.Duration()
	}
	return int(total.Milliseconds())
}

// FindBySourceURL returns a previously downloaded YouTube track, so the same
// video is never downloaded twice.
func (l *Library) FindBySourceURL(ctx context.Context, url string) (int64, bool, error) {
	var id int64
	err := l.DB.QueryRowContext(ctx, `SELECT id FROM tracks WHERE source_url = ? LIMIT 1`, url).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, false, nil
	}
	return id, err == nil, err
}

// ---------- folders ----------

type Folder struct {
	ID           int64  `json:"id"`
	OwnerUserID  *int64 `json:"owner_user_id"`
	ParentID     *int64 `json:"parent_id"`
	Name         string `json:"name"`
	SortOrder    int    `json:"sort_order"`
	SortMode     string `json:"sort_mode"`
	AutoDownload bool   `json:"auto_download"`
	Rev          int64  `json:"rev"`
	UpdatedAt    int64  `json:"updated_at"` // unix ms
	Deleted      bool   `json:"deleted"`
}

const folderCols = `id, owner_user_id, parent_id, name, sort_order, sort_mode, auto_download, rev, updated_at, deleted_at IS NOT NULL`

func scanFolder(sc interface{ Scan(...any) error }) (Folder, error) {
	var f Folder
	var owner, parent sql.NullInt64
	var updated time.Time
	err := sc.Scan(&f.ID, &owner, &parent, &f.Name, &f.SortOrder, &f.SortMode, &f.AutoDownload, &f.Rev, &updated, &f.Deleted)
	if owner.Valid {
		f.OwnerUserID = &owner.Int64
	}
	if parent.Valid {
		f.ParentID = &parent.Int64
	}
	f.UpdatedAt = updated.UnixMilli()
	return f, err
}

func (l *Library) GetFolder(ctx context.Context, ex db.Execer, id int64) (Folder, error) {
	f, err := scanFolder(ex.QueryRowContext(ctx, `SELECT `+folderCols+` FROM folders WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return f, ErrNotFound
	}
	return f, err
}

// CreateFolder creates a folder. owner nil = admin/shared folder.
func (l *Library) CreateFolder(ctx context.Context, ex db.Execer, owner *int64, parent *int64, name string) (int64, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return 0, fmt.Errorf("%w: folder name is required", ErrInvalid)
	}
	rev, err := db.NextRev(ctx, ex)
	if err != nil {
		return 0, err
	}
	var next int
	if err := ex.QueryRowContext(ctx,
		`SELECT COALESCE(MAX(sort_order), -1) + 1 FROM folders WHERE parent_id <=> ? AND owner_user_id <=> ? AND deleted_at IS NULL`,
		parent, owner).Scan(&next); err != nil {
		return 0, err
	}
	res, err := ex.ExecContext(ctx,
		`INSERT INTO folders (owner_user_id, parent_id, name, sort_order, rev) VALUES (?, ?, ?, ?, ?)`,
		owner, parent, truncate(name, 255), next, rev)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// EnsureChildFolder returns the live child folder with this name, creating it if needed.
func (l *Library) EnsureChildFolder(ctx context.Context, parent int64, name string) (int64, error) {
	p, err := l.GetFolder(ctx, l.DB, parent)
	if err != nil {
		return 0, err
	}
	var id int64
	err = l.DB.QueryRowContext(ctx,
		`SELECT id FROM folders WHERE parent_id = ? AND name = ? AND deleted_at IS NULL LIMIT 1`, parent, name).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}
	err = db.WithTx(ctx, l.DB, func(tx *sql.Tx) error {
		id, err = l.CreateFolder(ctx, tx, p.OwnerUserID, &parent, name)
		return err
	})
	return id, err
}

// IsDescendant reports whether candidate is folder or lies inside folder's subtree.
// It walks up from candidate, so it needs no recursive SQL (MySQL < 8.0 has none).
func (l *Library) IsDescendant(ctx context.Context, ex db.Execer, folder, candidate int64) (bool, error) {
	cur := candidate
	for depth := 0; depth < 1000; depth++ {
		if cur == folder {
			return true, nil
		}
		var parent sql.NullInt64
		err := ex.QueryRowContext(ctx, `SELECT parent_id FROM folders WHERE id = ?`, cur).Scan(&parent)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && !parent.Valid) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		cur = parent.Int64
	}
	return false, nil
}

// expandSubtrees returns roots plus all their descendants, one level per query.
// With liveOnly, deleted descendants (and their subtrees) are skipped.
func expandSubtrees(ctx context.Context, ex db.Execer, roots []int64, liveOnly bool) ([]int64, error) {
	seen := make(map[int64]bool, len(roots))
	all := []int64{}
	level := []int64{}
	for _, id := range roots {
		if !seen[id] {
			seen[id] = true
			all = append(all, id)
			level = append(level, id)
		}
	}
	for len(level) > 0 {
		in, args := inList(level)
		q := `SELECT id FROM folders WHERE parent_id IN (` + in + `)`
		if liveOnly {
			q += ` AND deleted_at IS NULL`
		}
		rows, err := ex.QueryContext(ctx, q, args...)
		if err != nil {
			return nil, err
		}
		level = level[:0:0]
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return nil, err
			}
			if !seen[id] {
				seen[id] = true
				all = append(all, id)
				level = append(level, id)
			}
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	return all, nil
}

// SubtreeIDs returns folder id and all of its descendants (live or deleted).
func (l *Library) SubtreeIDs(ctx context.Context, ex db.Execer, id int64) ([]int64, error) {
	return expandSubtrees(ctx, ex, []int64{id}, false)
}

func inList(ids []int64) (string, []any) {
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	return strings.TrimSuffix(strings.Repeat("?,", len(ids)), ","), args
}

// DeleteFolder soft-deletes a folder, its subtree and their items.
func (l *Library) DeleteFolder(ctx context.Context, ex db.Execer, id int64) error {
	return l.touchSubtree(ctx, ex, id, true)
}

// BumpSubtree gives a folder subtree and its items a fresh revision so that
// every client re-receives them (used after access changes or moves).
func (l *Library) BumpSubtree(ctx context.Context, ex db.Execer, id int64) error {
	return l.touchSubtree(ctx, ex, id, false)
}

func (l *Library) touchSubtree(ctx context.Context, ex db.Execer, id int64, del bool) error {
	ids, err := l.SubtreeIDs(ctx, ex, id)
	if err != nil || len(ids) == 0 {
		return err
	}
	rev, err := db.NextRev(ctx, ex)
	if err != nil {
		return err
	}
	ph, args := inList(ids)
	set, where := "rev = ?", ""
	if del {
		set, where = "rev = ?, deleted_at = NOW(3), updated_at = NOW(3)", " AND deleted_at IS NULL"
	}
	if _, err := ex.ExecContext(ctx, `UPDATE folder_tracks SET `+set+` WHERE folder_id IN (`+ph+`)`+where, append([]any{rev}, args...)...); err != nil {
		return err
	}
	_, err = ex.ExecContext(ctx, `UPDATE folders SET `+set+` WHERE id IN (`+ph+`)`+where, append([]any{rev}, args...)...)
	return err
}

// ---------- folder items ----------

// AttachTrack adds a track to a folder (reviving a deleted row) and returns the item id.
func (l *Library) AttachTrack(ctx context.Context, ex db.Execer, folderID, trackID int64) (int64, error) {
	rev, err := db.NextRev(ctx, ex)
	if err != nil {
		return 0, err
	}
	var next int
	if err := ex.QueryRowContext(ctx,
		`SELECT COALESCE(MAX(sort_order), -1) + 1 FROM folder_tracks WHERE folder_id = ? AND deleted_at IS NULL`,
		folderID).Scan(&next); err != nil {
		return 0, err
	}
	if _, err := ex.ExecContext(ctx, `
		INSERT INTO folder_tracks (folder_id, track_id, sort_order, rev) VALUES (?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			sort_order = IF(deleted_at IS NULL, sort_order, VALUES(sort_order)),
			deleted_at = NULL, updated_at = NOW(3), rev = VALUES(rev)`,
		folderID, trackID, next, rev); err != nil {
		return 0, err
	}
	var id int64
	err = ex.QueryRowContext(ctx, `SELECT id FROM folder_tracks WHERE folder_id = ? AND track_id = ?`, folderID, trackID).Scan(&id)
	return id, err
}

func (l *Library) DeleteItem(ctx context.Context, ex db.Execer, itemID int64) error {
	rev, err := db.NextRev(ctx, ex)
	if err != nil {
		return err
	}
	_, err = ex.ExecContext(ctx, `UPDATE folder_tracks SET deleted_at = NOW(3), updated_at = NOW(3), rev = ? WHERE id = ? AND deleted_at IS NULL`, rev, itemID)
	return err
}

// ReorderItems sets sort_order of the given items in the order provided.
func (l *Library) ReorderItems(ctx context.Context, ex db.Execer, folderID int64, itemIDs []int64) error {
	rev, err := db.NextRev(ctx, ex)
	if err != nil {
		return err
	}
	for i, id := range itemIDs {
		if _, err := ex.ExecContext(ctx, `UPDATE folder_tracks SET sort_order = ?, rev = ?, updated_at = NOW(3) WHERE id = ? AND folder_id = ?`,
			i, rev, id, folderID); err != nil {
			return err
		}
	}
	return nil
}

// ---------- visibility ----------

// VisibleFolderIDs returns the ids of all live folders a user can see: their own
// folders plus every admin folder (and subtree) granted to them directly or
// through a group.
func (l *Library) VisibleFolderIDs(ctx context.Context, userID int64) ([]int64, error) {
	rows, err := l.DB.QueryContext(ctx, `
		SELECT f.id FROM folders f
		WHERE f.deleted_at IS NULL AND (
			f.owner_user_id = ?
			OR f.id IN (
				SELECT fa.folder_id FROM folder_access fa
				WHERE fa.user_id = ?
				   OR fa.group_id IN (SELECT group_id FROM user_group_members WHERE user_id = ?)))`,
		userID, userID, userID)
	if err != nil {
		return nil, err
	}
	roots := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		roots = append(roots, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return expandSubtrees(ctx, l.DB, roots, true)
}

// inClause renders ids as a parenthesised IN list; an empty list matches nothing.
func inClause(ids []int64) (string, []any) {
	if len(ids) == 0 {
		return "(NULL)", nil
	}
	in, args := inList(ids)
	return "(" + in + ")", args
}

// CanSeeTrack reports whether a track lives in any folder visible to the user.
func (l *Library) CanSeeTrack(ctx context.Context, userID, trackID int64) (bool, error) {
	ids, err := l.VisibleFolderIDs(ctx, userID)
	if err != nil || len(ids) == 0 {
		return false, err
	}
	in, args := inClause(ids)
	var n int
	err = l.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM folder_tracks WHERE track_id = ? AND folder_id IN `+in,
		append([]any{trackID}, args...)...).Scan(&n)
	return n > 0, err
}

// TrackKeys returns the storage keys for a track.
func (l *Library) TrackKeys(ctx context.Context, trackID int64) (object string, cover string, err error) {
	var c sql.NullString
	err = l.DB.QueryRowContext(ctx, `SELECT object_key, cover_key FROM tracks WHERE id = ?`, trackID).Scan(&object, &c)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", ErrNotFound
	}
	return object, c.String, err
}

// ---------- helpers ----------

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}

func sourceOr(s string) string {
	if s == "" {
		return "upload"
	}
	return s
}

func nullStr(s string) sql.NullString { return sql.NullString{String: s, Valid: s != ""} }
