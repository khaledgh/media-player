package library

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"mume/server/internal/db"
)

type FavFolder struct {
	ID        int64  `json:"id"`
	Ref       string `json:"ref,omitempty"`
	Name      string `json:"name"`
	UpdatedAt int64  `json:"updated_at"`
	Deleted   bool   `json:"deleted"`
}

type FavItem struct {
	TrackID   int64  `json:"track_id"`
	FolderID  *int64 `json:"folder_id"`
	FolderRef string `json:"folder_ref,omitempty"`
	AddedAt   int64  `json:"added_at"`
	UpdatedAt int64  `json:"updated_at"`
	Deleted   bool   `json:"deleted"`
}

type Favorites struct {
	Folders []FavFolder `json:"folders"`
	Items   []FavItem   `json:"items"`
}

// GetFavorites returns all of a user's favorites, tombstones included so
// other devices can apply deletions.
func (l *Library) GetFavorites(ctx context.Context, userID int64) (*Favorites, error) {
	out := &Favorites{Folders: []FavFolder{}, Items: []FavItem{}}
	rows, err := l.DB.QueryContext(ctx, `SELECT id, name, updated_at, deleted FROM favorite_folders WHERE user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var f FavFolder
		if err := rows.Scan(&f.ID, &f.Name, &f.UpdatedAt, &f.Deleted); err != nil {
			rows.Close()
			return nil, err
		}
		out.Folders = append(out.Folders, f)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows, err = l.DB.QueryContext(ctx, `SELECT track_id, folder_id, added_at, updated_at, deleted FROM favorites WHERE user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var it FavItem
		var folder sql.NullInt64
		if err := rows.Scan(&it.TrackID, &folder, &it.AddedAt, &it.UpdatedAt, &it.Deleted); err != nil {
			return nil, err
		}
		if folder.Valid {
			it.FolderID = &folder.Int64
		}
		out.Items = append(out.Items, it)
	}
	return out, rows.Err()
}

// PushFavorites applies device changes with last-write-wins per row and
// returns the server ids of folders created in this batch, keyed by ref.
func (l *Library) PushFavorites(ctx context.Context, userID int64, in Favorites) (map[string]int64, error) {
	refs := map[string]int64{}
	err := db.WithTx(ctx, l.DB, func(tx *sql.Tx) error {
		for _, f := range in.Folders {
			name := strings.TrimSpace(f.Name)
			if f.ID == 0 {
				if name == "" {
					return fmt.Errorf("%w: folder name is required", ErrInvalid)
				}
				res, err := tx.ExecContext(ctx, `INSERT INTO favorite_folders (user_id, name, updated_at, deleted) VALUES (?, ?, ?, ?)`,
					userID, truncate(name, 255), f.UpdatedAt, f.Deleted)
				if err != nil {
					return err
				}
				id, _ := res.LastInsertId()
				if f.Ref != "" {
					refs[f.Ref] = id
				}
				continue
			}
			if f.Ref != "" {
				refs[f.Ref] = f.ID
			}
			if name == "" {
				name = "-"
			}
			if _, err := tx.ExecContext(ctx, `UPDATE favorite_folders SET name = ?, deleted = ?, updated_at = ? WHERE id = ? AND user_id = ? AND updated_at <= ?`,
				truncate(name, 255), f.Deleted, f.UpdatedAt, f.ID, userID, f.UpdatedAt); err != nil {
				return err
			}
		}
		for _, it := range in.Items {
			var folder any
			switch {
			case it.FolderRef != "":
				id, ok := refs[it.FolderRef]
				if !ok {
					return fmt.Errorf("%w: unknown folder ref %q", ErrInvalid, it.FolderRef)
				}
				folder = id
			case it.FolderID != nil:
				var own int
				if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM favorite_folders WHERE id = ? AND user_id = ?`, *it.FolderID, userID).Scan(&own); err != nil {
					return err
				}
				if own == 0 {
					return ErrForbidden
				}
				folder = *it.FolderID
			}
			var visible int
			if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM tracks WHERE id = ?`, it.TrackID).Scan(&visible); err != nil {
				return err
			}
			if visible == 0 {
				continue // track no longer exists
			}
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO favorites (user_id, track_id, folder_id, added_at, updated_at, deleted) VALUES (?, ?, ?, ?, ?, ?)
				ON DUPLICATE KEY UPDATE
					folder_id = IF(updated_at <= VALUES(updated_at), VALUES(folder_id), folder_id),
					deleted = IF(updated_at <= VALUES(updated_at), VALUES(deleted), deleted),
					added_at = IF(updated_at <= VALUES(updated_at), VALUES(added_at), added_at),
					updated_at = GREATEST(updated_at, VALUES(updated_at))`,
				userID, it.TrackID, folder, it.AddedAt, it.UpdatedAt, it.Deleted); err != nil {
				return err
			}
		}
		return nil
	})
	return refs, err
}

// RecordDownloads remembers that the user downloaded these tracks.
func (l *Library) RecordDownloads(ctx context.Context, userID int64, trackIDs []int64, at int64) error {
	for _, id := range trackIDs {
		ok, err := l.CanSeeTrack(ctx, userID, id)
		if err != nil {
			return err
		}
		if !ok {
			continue
		}
		if _, err := l.DB.ExecContext(ctx, `
			INSERT INTO download_history (user_id, track_id, last_downloaded_at) VALUES (?, ?, ?)
			ON DUPLICATE KEY UPDATE last_downloaded_at = VALUES(last_downloaded_at), downloads = downloads + 1`, userID, id, at); err != nil {
			return err
		}
	}
	return nil
}

// DownloadedTrackIDs lists tracks the user downloaded before that they can still see.
func (l *Library) DownloadedTrackIDs(ctx context.Context, userID int64) ([]int64, error) {
	vis, err := l.VisibleFolderIDs(ctx, userID)
	if err != nil {
		return nil, err
	}
	in, args := inClause(vis)
	rows, err := l.DB.QueryContext(ctx, `
		SELECT h.track_id FROM download_history h
		WHERE h.user_id = ? AND EXISTS (
			SELECT 1 FROM folder_tracks ft WHERE ft.track_id = h.track_id AND ft.deleted_at IS NULL AND ft.folder_id IN `+in+`)
		ORDER BY h.last_downloaded_at DESC`, append([]any{userID}, args...)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
