package library

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"mume/server/internal/db"
)

type Item struct {
	ID        int64 `json:"id"`
	FolderID  int64 `json:"folder_id"`
	TrackID   int64 `json:"track_id"`
	SortOrder int   `json:"sort_order"`
	Rev       int64 `json:"rev"`
	AddedAt   int64 `json:"added_at"`
	UpdatedAt int64 `json:"updated_at"`
	Deleted   bool  `json:"deleted"`
}

type PullResult struct {
	Cursor int64 `json:"cursor"`
	// VisibleFolderIDs is the complete set of folders the user can currently
	// see; clients drop any synced folder that is not in it (revoked access).
	VisibleFolderIDs []int64  `json:"visible_folder_ids"`
	Folders          []Folder `json:"folders"`
	Items            []Item   `json:"items"`
	Tracks           []Track  `json:"tracks"`
}

// Pull returns every change visible to userID with since < rev <= cursor.
func (l *Library) Pull(ctx context.Context, userID, since int64) (*PullResult, error) {
	res := &PullResult{Folders: []Folder{}, Items: []Item{}, Tracks: []Track{}}
	// Read the cursor first: writers hold the counter row lock until commit,
	// so every revision <= cursor is already committed.
	if err := l.DB.QueryRowContext(ctx, `SELECT v FROM rev_counter WHERE id = 1`).Scan(&res.Cursor); err != nil {
		return nil, err
	}
	ids, err := l.VisibleFolderIDs(ctx, userID)
	if err != nil {
		return nil, err
	}
	res.VisibleFolderIDs = ids

	// Own folders including tombstones, plus live shared folders.
	rows, err := l.DB.QueryContext(ctx, visibleFoldersCTE+`
		SELECT `+folderCols+` FROM folders
		WHERE rev > ? AND rev <= ? AND (owner_user_id = ? OR id IN (SELECT id FROM visible))`,
		userID, userID, userID, since, res.Cursor, userID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		f, err := scanFolder(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		res.Folders = append(res.Folders, f)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	rows, err = l.DB.QueryContext(ctx, visibleFoldersCTE+`
		SELECT ft.id, ft.folder_id, ft.track_id, ft.sort_order, ft.rev, ft.added_at, ft.updated_at, ft.deleted_at IS NOT NULL
		FROM folder_tracks ft JOIN folders f ON f.id = ft.folder_id
		WHERE ft.rev > ? AND ft.rev <= ? AND (f.owner_user_id = ? OR ft.folder_id IN (SELECT id FROM visible))`,
		userID, userID, userID, since, res.Cursor, userID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var it Item
		var added, updated time.Time
		if err := rows.Scan(&it.ID, &it.FolderID, &it.TrackID, &it.SortOrder, &it.Rev, &added, &updated, &it.Deleted); err != nil {
			rows.Close()
			return nil, err
		}
		it.AddedAt, it.UpdatedAt = added.UnixMilli(), updated.UnixMilli()
		res.Items = append(res.Items, it)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Tracks referenced by changed items, plus visible tracks whose metadata changed.
	rows, err = l.DB.QueryContext(ctx, visibleFoldersCTE+`
		SELECT t.id, t.title, t.artist, t.album, t.duration_ms, t.size_bytes, t.mime, t.cover_key IS NOT NULL, t.source, COALESCE(t.source_url, ''), t.rev
		FROM tracks t
		WHERE t.id IN (
			SELECT ft.track_id FROM folder_tracks ft
			WHERE ft.deleted_at IS NULL AND ft.folder_id IN (SELECT id FROM visible)
			  AND (ft.rev > ? OR t.rev > ?))`,
		userID, userID, userID, since, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var t Track
		if err := rows.Scan(&t.ID, &t.Title, &t.Artist, &t.Album, &t.DurationMs, &t.SizeBytes, &t.Mime, &t.HasCover, &t.Source, &t.SourceURL, &t.Rev); err != nil {
			return nil, err
		}
		res.Tracks = append(res.Tracks, t)
	}
	return res, rows.Err()
}

// ---------- push ----------

// Op is one offline change made on a device.
// Refs ("c:<local id>") let ops point at folders/items created earlier in the same batch.
type Op struct {
	Op           string  `json:"op"` // folder.upsert | folder.delete | item.upsert | item.delete
	Ref          string  `json:"ref,omitempty"`
	ID           int64   `json:"id,omitempty"`
	ParentID     *int64  `json:"parent_id,omitempty"`
	ParentRef    string  `json:"parent_ref,omitempty"`
	ToRoot       bool    `json:"to_root,omitempty"` // move to the top level
	FolderID     int64   `json:"folder_id,omitempty"`
	FolderRef    string  `json:"folder_ref,omitempty"`
	TrackID      int64   `json:"track_id,omitempty"`
	Name         *string `json:"name,omitempty"`
	SortOrder    *int    `json:"sort_order,omitempty"`
	SortMode     *string `json:"sort_mode,omitempty"`
	AutoDownload *bool   `json:"auto_download,omitempty"`
	UpdatedAt    int64   `json:"updated_at"` // device clock, unix ms
}

type OpError struct {
	Index int    `json:"index"`
	Error string `json:"error"`
}

type PushResult struct {
	Folders map[string]int64 `json:"folders"` // ref -> server id
	Items   map[string]int64 `json:"items"`
	Errors  []OpError        `json:"errors"`
}

var validSortModes = map[string]bool{
	"custom": true, "title": true, "title_desc": true, "artist": true, "artist_desc": true,
	"added": true, "added_desc": true, "duration": true, "duration_desc": true,
}

// Push applies ops in order. Each op runs in its own transaction so one bad
// op does not block the rest; failures are reported per index.
func (l *Library) Push(ctx context.Context, userID int64, ops []Op) *PushResult {
	res := &PushResult{Folders: map[string]int64{}, Items: map[string]int64{}, Errors: []OpError{}}
	for i, op := range ops {
		err := db.WithTx(ctx, l.DB, func(tx *sql.Tx) error { return l.applyOp(ctx, tx, userID, op, res) })
		if err != nil {
			res.Errors = append(res.Errors, OpError{Index: i, Error: err.Error()})
		}
	}
	return res
}

func resolve(id int64, ref string, refs map[string]int64) (int64, error) {
	if ref != "" {
		if v, ok := refs[ref]; ok {
			return v, nil
		}
		return 0, fmt.Errorf("%w: unknown ref %q", ErrInvalid, ref)
	}
	return id, nil
}

func (l *Library) ownFolder(ctx context.Context, tx *sql.Tx, userID, id int64) (Folder, error) {
	f, err := scanFolder(tx.QueryRowContext(ctx, `SELECT `+folderCols+` FROM folders WHERE id = ? FOR UPDATE`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return f, ErrNotFound
	}
	if err != nil {
		return f, err
	}
	if f.OwnerUserID == nil || *f.OwnerUserID != userID {
		return f, ErrForbidden
	}
	return f, nil
}

func (l *Library) applyOp(ctx context.Context, tx *sql.Tx, userID int64, op Op, res *PushResult) error {
	switch op.Op {
	case "folder.upsert":
		return l.upsertFolder(ctx, tx, userID, op, res)
	case "folder.delete":
		id, err := resolve(op.ID, op.Ref, res.Folders)
		if err != nil {
			return err
		}
		if _, err := l.ownFolder(ctx, tx, userID, id); err != nil {
			return err
		}
		return l.DeleteFolder(ctx, tx, id)
	case "item.upsert":
		return l.upsertItem(ctx, tx, userID, op, res)
	case "item.delete":
		id, err := resolve(op.ID, op.Ref, res.Items)
		if err != nil {
			return err
		}
		var folderID int64
		if err := tx.QueryRowContext(ctx, `SELECT folder_id FROM folder_tracks WHERE id = ?`, id).Scan(&folderID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if _, err := l.ownFolder(ctx, tx, userID, folderID); err != nil {
			return err
		}
		return l.DeleteItem(ctx, tx, id)
	}
	return fmt.Errorf("%w: unknown op %q", ErrInvalid, op.Op)
}

func (l *Library) upsertFolder(ctx context.Context, tx *sql.Tx, userID int64, op Op, res *PushResult) error {
	var parent *int64
	if op.ParentRef != "" {
		p, err := resolve(0, op.ParentRef, res.Folders)
		if err != nil {
			return err
		}
		parent = &p
	} else if op.ParentID != nil {
		parent = op.ParentID
	}
	if parent != nil {
		if _, err := l.ownFolder(ctx, tx, userID, *parent); err != nil {
			return fmt.Errorf("parent: %w", err)
		}
	}
	if op.SortMode != nil && !validSortModes[*op.SortMode] {
		return fmt.Errorf("%w: sort_mode %q", ErrInvalid, *op.SortMode)
	}

	if op.ID == 0 { // create
		if op.Name == nil {
			return fmt.Errorf("%w: name is required", ErrInvalid)
		}
		id, err := l.CreateFolder(ctx, tx, &userID, parent, *op.Name)
		if err != nil {
			return err
		}
		if op.Ref != "" {
			res.Folders[op.Ref] = id
		}
		return l.updateFolderFields(ctx, tx, id, op, nil)
	}

	f, err := l.ownFolder(ctx, tx, userID, op.ID)
	if err != nil {
		return err
	}
	if op.Ref != "" {
		res.Folders[op.Ref] = f.ID
	}
	if f.Deleted || (op.UpdatedAt > 0 && op.UpdatedAt < f.UpdatedAt) {
		return nil // deleted elsewhere, or a newer server edit wins
	}
	if parent != nil {
		inside, err := l.IsDescendant(ctx, tx, f.ID, *parent)
		if err != nil {
			return err
		}
		if inside {
			return fmt.Errorf("%w: cannot move a folder into itself", ErrInvalid)
		}
	}
	return l.updateFolderFields(ctx, tx, f.ID, op, parent)
}

func (l *Library) updateFolderFields(ctx context.Context, tx *sql.Tx, id int64, op Op, parent *int64) error {
	sets, args := []string{}, []any{}
	if op.Name != nil && op.ID != 0 {
		name := strings.TrimSpace(*op.Name)
		if name == "" {
			return fmt.Errorf("%w: folder name is required", ErrInvalid)
		}
		sets, args = append(sets, "name = ?"), append(args, truncate(name, 255))
	}
	if parent != nil && op.ID != 0 {
		sets, args = append(sets, "parent_id = ?"), append(args, *parent)
	} else if op.ToRoot && op.ID != 0 {
		sets = append(sets, "parent_id = NULL")
	}
	if op.SortOrder != nil {
		sets, args = append(sets, "sort_order = ?"), append(args, *op.SortOrder)
	}
	if op.SortMode != nil {
		sets, args = append(sets, "sort_mode = ?"), append(args, *op.SortMode)
	}
	if op.AutoDownload != nil {
		sets, args = append(sets, "auto_download = ?"), append(args, *op.AutoDownload)
	}
	if len(sets) == 0 {
		return nil
	}
	rev, err := db.NextRev(ctx, tx)
	if err != nil {
		return err
	}
	args = append(args, rev, id)
	_, err = tx.ExecContext(ctx, `UPDATE folders SET `+strings.Join(sets, ", ")+`, rev = ?, updated_at = NOW(3) WHERE id = ?`, args...)
	return err
}

func (l *Library) upsertItem(ctx context.Context, tx *sql.Tx, userID int64, op Op, res *PushResult) error {
	folderID, err := resolve(op.FolderID, op.FolderRef, res.Folders)
	if err != nil {
		return err
	}

	if op.ID != 0 { // existing item: reorder and/or move
		var curFolder, trackID int64
		var updated time.Time
		var deleted bool
		err := tx.QueryRowContext(ctx, `SELECT folder_id, track_id, updated_at, deleted_at IS NOT NULL FROM folder_tracks WHERE id = ? FOR UPDATE`, op.ID).
			Scan(&curFolder, &trackID, &updated, &deleted)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if _, err := l.ownFolder(ctx, tx, userID, curFolder); err != nil {
			return err
		}
		if deleted || (op.UpdatedAt > 0 && op.UpdatedAt < updated.UnixMilli()) {
			if op.Ref != "" {
				res.Items[op.Ref] = op.ID
			}
			return nil
		}
		if folderID == 0 || folderID == curFolder { // reorder in place
			if op.Ref != "" {
				res.Items[op.Ref] = op.ID
			}
			if op.SortOrder == nil {
				return nil
			}
			rev, err := db.NextRev(ctx, tx)
			if err != nil {
				return err
			}
			_, err = tx.ExecContext(ctx, `UPDATE folder_tracks SET sort_order = ?, rev = ?, updated_at = NOW(3) WHERE id = ?`, *op.SortOrder, rev, op.ID)
			return err
		}
		// Move: tombstone the old row and attach to the target folder.
		if _, err := l.ownFolder(ctx, tx, userID, folderID); err != nil {
			return err
		}
		if err := l.DeleteItem(ctx, tx, op.ID); err != nil {
			return err
		}
		return l.attachWithOrder(ctx, tx, folderID, trackID, op, res)
	}

	// New item (add / copy a track into a folder).
	if _, err := l.ownFolder(ctx, tx, userID, folderID); err != nil {
		return err
	}
	ok, err := l.CanSeeTrack(ctx, userID, op.TrackID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrForbidden
	}
	return l.attachWithOrder(ctx, tx, folderID, op.TrackID, op, res)
}

func (l *Library) attachWithOrder(ctx context.Context, tx *sql.Tx, folderID, trackID int64, op Op, res *PushResult) error {
	id, err := l.AttachTrack(ctx, tx, folderID, trackID)
	if err != nil {
		return err
	}
	if op.Ref != "" {
		res.Items[op.Ref] = id
	}
	if op.SortOrder != nil {
		_, err = tx.ExecContext(ctx, `UPDATE folder_tracks SET sort_order = ? WHERE id = ?`, *op.SortOrder, id)
	}
	return err
}
