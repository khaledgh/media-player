package library

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"mume/server/internal/db"
)

type TrackMeta struct {
	ID     int64
	Title  string
	Artist string
}

// TrackMetas returns the current title and artist of the given tracks.
func (l *Library) TrackMetas(ctx context.Context, ids []int64) ([]TrackMeta, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	in, args := inList(ids)
	rows, err := l.DB.QueryContext(ctx, `SELECT id, title, artist FROM tracks WHERE id IN (`+in+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TrackMeta
	for rows.Next() {
		var m TrackMeta
		if err := rows.Scan(&m.ID, &m.Title, &m.Artist); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// SetTrackMeta updates a track's title and artist and bumps its revision so
// every device receives the new names on its next sync.
func (l *Library) SetTrackMeta(ctx context.Context, ex db.Execer, id int64, title, artist string) error {
	title = strings.TrimSpace(title)
	if title == "" {
		return ErrInvalid
	}
	rev, err := db.NextRev(ctx, ex)
	if err != nil {
		return err
	}
	_, err = ex.ExecContext(ctx, `UPDATE tracks SET title = ?, artist = ?, rev = ? WHERE id = ?`,
		truncate(title, 512), truncate(strings.TrimSpace(artist), 512), rev, id)
	return err
}

// CanEditTrack reports whether a user may rename a track: it must sit in at
// least one of the user's own folders (shared admin folders stay CMS-managed).
func (l *Library) CanEditTrack(ctx context.Context, userID, trackID int64) (bool, error) {
	var n int
	err := l.DB.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM folder_tracks ft JOIN folders f ON f.id = ft.folder_id
		WHERE ft.track_id = ? AND ft.deleted_at IS NULL AND f.deleted_at IS NULL AND f.owner_user_id = ?`,
		trackID, userID).Scan(&n)
	return n > 0, err
}

// EnsureUserRootFolder returns the user's top-level folder with this name
// (case-insensitive), creating it when missing.
func (l *Library) EnsureUserRootFolder(ctx context.Context, userID int64, name string) (int64, error) {
	name = strings.TrimSpace(name)
	var id int64
	err := l.DB.QueryRowContext(ctx,
		`SELECT id FROM folders WHERE owner_user_id = ? AND parent_id IS NULL AND name = ? AND deleted_at IS NULL LIMIT 1`,
		userID, name).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}
	err = db.WithTx(ctx, l.DB, func(tx *sql.Tx) error {
		id, err = l.CreateFolder(ctx, tx, &userID, nil, name)
		return err
	})
	return id, err
}
