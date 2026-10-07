package api

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-sql-driver/mysql"

	"mume/server/internal/auth"
	"mume/server/internal/db"
	"mume/server/internal/library"
)

func (s *Server) adminRoutes(r chi.Router) {
	r.Get("/stats", s.adminStats)

	r.Get("/users", s.listUsers)
	r.Post("/users", s.createUser)
	r.Patch("/users/{id}", s.updateUser)
	r.Delete("/users/{id}", s.deleteUser)
	r.Get("/users/{id}/sessions", s.userSessions)

	r.Get("/groups", s.listGroups)
	r.Post("/groups", s.createGroup)
	r.Patch("/groups/{id}", s.renameGroup)
	r.Delete("/groups/{id}", s.deleteGroup)
	r.Put("/groups/{id}/members", s.setGroupMembers)

	r.Get("/folders", s.listFolders)
	r.Post("/folders", s.createAdminFolder)
	r.Patch("/folders/{id}", s.updateAdminFolder)
	r.Delete("/folders/{id}", s.deleteAdminFolder)
	r.Get("/folders/{id}/tracks", s.folderTracks)
	r.Post("/folders/{id}/tracks", s.addTracksToFolder)
	r.Put("/folders/{id}/tracks/order", s.reorderFolderTracks)
	r.Delete("/folders/{id}/tracks/{itemId}", s.removeFolderTrack)
	r.Post("/folders/{id}/upload", s.uploadToFolder)
	r.Get("/folders/{id}/access", s.getAccess)
	r.Put("/folders/{id}/access", s.setAccess)

	r.Get("/tracks", s.searchTracks)
	r.Patch("/tracks/{id}", s.updateTrack)
	r.Post("/tracks/ai-suggest", s.suggestNames)
	r.Get("/stats/overview", s.adminOverview)
	r.Get("/users/{id}/activity", s.adminUserActivity)
	r.Get("/tracks/{id}/url", s.adminTrackURL)

	r.Get("/imports", s.listImports)
	r.Get("/imports/{id}", s.getImport)
	r.Get("/youtube-jobs", s.listYouTubeJobs)
}

func isDuplicate(err error) bool {
	var me *mysql.MySQLError
	return errors.As(err, &me) && me.Number == 1062
}

// ---------- stats ----------

func (s *Server) adminStats(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	out := map[string]int64{}
	queries := map[string]string{
		"users":          `SELECT COUNT(*) FROM users`,
		"tracks":         `SELECT COUNT(*) FROM tracks`,
		"storage_bytes":  `SELECT COALESCE(SUM(size_bytes), 0) FROM tracks`,
		"shared_folders": `SELECT COUNT(*) FROM folders WHERE owner_user_id IS NULL AND deleted_at IS NULL`,
		"user_folders":   `SELECT COUNT(*) FROM folders WHERE owner_user_id IS NOT NULL AND deleted_at IS NULL`,
		"youtube_today":  `SELECT COUNT(*) FROM youtube_jobs WHERE created_at > NOW() - INTERVAL 1 DAY`,
		"youtube_failed": `SELECT COUNT(*) FROM youtube_jobs WHERE status = 'error' AND created_at > NOW() - INTERVAL 7 DAY`,
		"active_devices": `SELECT COUNT(*) FROM refresh_tokens WHERE revoked = FALSE AND expires_at > NOW(3) AND last_used_at > NOW() - INTERVAL 30 DAY`,
	}
	for k, q := range queries {
		var v int64
		if err := s.DB.QueryRowContext(ctx, q).Scan(&v); err != nil {
			fail(w, err)
			return
		}
		out[k] = v
	}
	writeJSON(w, http.StatusOK, out)
}

// ---------- users ----------

type adminUser struct {
	ID        int64   `json:"id"`
	Email     string  `json:"email"`
	Name      string  `json:"name"`
	Role      string  `json:"role"`
	Disabled  bool    `json:"disabled"`
	CreatedAt int64   `json:"created_at"`
	GroupIDs  []int64 `json:"group_ids"`
	Tracks    int     `json:"tracks"`
}

func (s *Server) listUsers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	rows, err := s.DB.QueryContext(ctx, `
		SELECT u.id, u.email, u.name, u.role, u.disabled, u.created_at,
			COALESCE((SELECT GROUP_CONCAT(group_id) FROM user_group_members m WHERE m.user_id = u.id), ''),
			(SELECT COUNT(*) FROM folder_tracks ft JOIN folders f ON f.id = ft.folder_id
			 WHERE f.owner_user_id = u.id AND ft.deleted_at IS NULL)
		FROM users u ORDER BY u.id`)
	if err != nil {
		fail(w, err)
		return
	}
	defer rows.Close()
	out := []adminUser{}
	for rows.Next() {
		var u adminUser
		var created time.Time
		var groups string
		if err := rows.Scan(&u.ID, &u.Email, &u.Name, &u.Role, &u.Disabled, &created, &groups, &u.Tracks); err != nil {
			fail(w, err)
			return
		}
		u.CreatedAt, u.GroupIDs = created.UnixMilli(), parseIDs(groups)
		out = append(out, u)
	}
	writeJSON(w, http.StatusOK, out)
}

func parseIDs(csv string) []int64 {
	ids := []int64{}
	for _, p := range strings.Split(csv, ",") {
		if v, err := strconv.ParseInt(p, 10, 64); err == nil {
			ids = append(ids, v)
		}
	}
	return ids
}

func validRole(role string) bool { return role == "admin" || role == "user" }

func (s *Server) createUser(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email    string  `json:"email"`
		Name     string  `json:"name"`
		Password string  `json:"password"`
		Role     string  `json:"role"`
		GroupIDs []int64 `json:"group_ids"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	in.Email = strings.ToLower(strings.TrimSpace(in.Email))
	if in.Role == "" {
		in.Role = "user"
	}
	if !strings.Contains(in.Email, "@") || len(in.Password) < 8 || !validRole(in.Role) {
		writeErr(w, http.StatusBadRequest, "a valid email, a password of at least 8 characters and a role of admin or user are required")
		return
	}
	hash, err := auth.HashPassword(in.Password)
	if err != nil {
		fail(w, err)
		return
	}
	ctx := r.Context()
	var id int64
	err = db.WithTx(ctx, s.DB, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)`,
			in.Email, strings.TrimSpace(in.Name), hash, in.Role)
		if err != nil {
			return err
		}
		id, _ = res.LastInsertId()
		for _, g := range in.GroupIDs {
			if _, err := tx.ExecContext(ctx, `INSERT IGNORE INTO user_group_members (group_id, user_id) VALUES (?, ?)`, g, id); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]int64{"id": id})
}

func (s *Server) updateUser(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(r, "id")
	if !ok {
		badID(w)
		return
	}
	var in struct {
		Name     *string  `json:"name"`
		Role     *string  `json:"role"`
		Disabled *bool    `json:"disabled"`
		Password *string  `json:"password"`
		GroupIDs *[]int64 `json:"group_ids"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	self := auth.FromContext(r.Context()).UserID == id
	if self && ((in.Disabled != nil && *in.Disabled) || (in.Role != nil && *in.Role != "admin")) {
		writeErr(w, http.StatusBadRequest, "you cannot disable or demote your own account")
		return
	}
	sets, args := []string{}, []any{}
	if in.Name != nil {
		sets, args = append(sets, "name = ?"), append(args, strings.TrimSpace(*in.Name))
	}
	if in.Role != nil {
		if !validRole(*in.Role) {
			writeErr(w, http.StatusBadRequest, "role must be admin or user")
			return
		}
		sets, args = append(sets, "role = ?"), append(args, *in.Role)
	}
	if in.Disabled != nil {
		sets, args = append(sets, "disabled = ?"), append(args, *in.Disabled)
	}
	if in.Password != nil {
		if len(*in.Password) < 8 {
			writeErr(w, http.StatusBadRequest, "password must be at least 8 characters")
			return
		}
		hash, err := auth.HashPassword(*in.Password)
		if err != nil {
			fail(w, err)
			return
		}
		sets, args = append(sets, "password_hash = ?"), append(args, hash)
	}
	ctx := r.Context()
	err := db.WithTx(ctx, s.DB, func(tx *sql.Tx) error {
		if len(sets) > 0 {
			res, err := tx.ExecContext(ctx, `UPDATE users SET `+strings.Join(sets, ", ")+` WHERE id = ?`, append(args, id)...)
			if err != nil {
				return err
			}
			if n, _ := res.RowsAffected(); n == 0 {
				var exists int
				if tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE id = ?`, id).Scan(&exists); exists == 0 {
					return library.ErrNotFound
				}
			}
		}
		// Disabling a user or resetting their password signs out every device.
		if (in.Disabled != nil && *in.Disabled) || in.Password != nil {
			if _, err := tx.ExecContext(ctx, `UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = ?`, id); err != nil {
				return err
			}
		}
		if in.GroupIDs != nil {
			if err := s.replaceUserGroups(ctx, tx, id, *in.GroupIDs); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// replaceUserGroups changes a user's groups and re-syncs folders granted through them.
func (s *Server) replaceUserGroups(ctx context.Context, tx *sql.Tx, userID int64, groupIDs []int64) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM user_group_members WHERE user_id = ?`, userID); err != nil {
		return err
	}
	for _, g := range groupIDs {
		if _, err := tx.ExecContext(ctx, `INSERT INTO user_group_members (group_id, user_id) VALUES (?, ?)`, g, userID); err != nil {
			return err
		}
	}
	return s.bumpGroupFolders(ctx, tx, groupIDs)
}

// bumpGroupFolders re-sends folders granted to these groups so new members receive them.
func (s *Server) bumpGroupFolders(ctx context.Context, tx *sql.Tx, groupIDs []int64) error {
	for _, g := range groupIDs {
		rows, err := tx.QueryContext(ctx, `SELECT folder_id FROM folder_access WHERE group_id = ?`, g)
		if err != nil {
			return err
		}
		var folders []int64
		for rows.Next() {
			var f int64
			if err := rows.Scan(&f); err != nil {
				rows.Close()
				return err
			}
			folders = append(folders, f)
		}
		rows.Close()
		for _, f := range folders {
			if err := s.Lib.BumpSubtree(ctx, tx, f); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Server) deleteUser(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(r, "id")
	if !ok {
		badID(w)
		return
	}
	if auth.FromContext(r.Context()).UserID == id {
		writeErr(w, http.StatusBadRequest, "you cannot delete your own account")
		return
	}
	res, err := s.DB.ExecContext(r.Context(), `DELETE FROM users WHERE id = ?`, id)
	if err != nil {
		fail(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		fail(w, library.ErrNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) userSessions(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(r, "id")
	if !ok {
		badID(w)
		return
	}
	rows, err := s.DB.QueryContext(r.Context(), `
		SELECT id, device_name, last_used_at, expires_at FROM refresh_tokens
		WHERE user_id = ? AND revoked = FALSE AND expires_at > NOW(3) ORDER BY last_used_at DESC`, id)
	if err != nil {
		fail(w, err)
		return
	}
	defer rows.Close()
	type session struct {
		ID         int64  `json:"id"`
		DeviceName string `json:"device_name"`
		LastUsedAt int64  `json:"last_used_at"`
		ExpiresAt  int64  `json:"expires_at"`
	}
	out := []session{}
	for rows.Next() {
		var ss session
		var last, exp time.Time
		if err := rows.Scan(&ss.ID, &ss.DeviceName, &last, &exp); err != nil {
			fail(w, err)
			return
		}
		ss.LastUsedAt, ss.ExpiresAt = last.UnixMilli(), exp.UnixMilli()
		out = append(out, ss)
	}
	writeJSON(w, http.StatusOK, out)
}

// ---------- groups ----------

func (s *Server) listGroups(w http.ResponseWriter, r *http.Request) {
	rows, err := s.DB.QueryContext(r.Context(), `
		SELECT g.id, g.name, COALESCE((SELECT GROUP_CONCAT(user_id) FROM user_group_members m WHERE m.group_id = g.id), '')
		FROM user_groups g ORDER BY g.name`)
	if err != nil {
		fail(w, err)
		return
	}
	defer rows.Close()
	type group struct {
		ID      int64   `json:"id"`
		Name    string  `json:"name"`
		UserIDs []int64 `json:"user_ids"`
	}
	out := []group{}
	for rows.Next() {
		var g group
		var members string
		if err := rows.Scan(&g.ID, &g.Name, &members); err != nil {
			fail(w, err)
			return
		}
		g.UserIDs = parseIDs(members)
		out = append(out, g)
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) createGroup(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name string `json:"name"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.Name) == "" {
		writeErr(w, http.StatusBadRequest, "name is required")
		return
	}
	res, err := s.DB.ExecContext(r.Context(), `INSERT INTO user_groups (name) VALUES (?)`, strings.TrimSpace(in.Name))
	if err != nil {
		fail(w, err)
		return
	}
	id, _ := res.LastInsertId()
	writeJSON(w, http.StatusCreated, map[string]int64{"id": id})
}

func (s *Server) renameGroup(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(r, "id")
	if !ok {
		badID(w)
		return
	}
	var in struct {
		Name string `json:"name"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.Name) == "" {
		writeErr(w, http.StatusBadRequest, "name is required")
		return
	}
	if _, err := s.DB.ExecContext(r.Context(), `UPDATE user_groups SET name = ? WHERE id = ?`, strings.TrimSpace(in.Name), id); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) deleteGroup(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(r, "id")
	if !ok {
		badID(w)
		return
	}
	if _, err := s.DB.ExecContext(r.Context(), `DELETE FROM user_groups WHERE id = ?`, id); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) setGroupMembers(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(r, "id")
	if !ok {
		badID(w)
		return
	}
	var in struct {
		UserIDs []int64 `json:"user_ids"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	ctx := r.Context()
	err := db.WithTx(ctx, s.DB, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM user_group_members WHERE group_id = ?`, id); err != nil {
			return err
		}
		for _, u := range in.UserIDs {
			if _, err := tx.ExecContext(ctx, `INSERT INTO user_group_members (group_id, user_id) VALUES (?, ?)`, id, u); err != nil {
				return err
			}
		}
		return s.bumpGroupFolders(ctx, tx, []int64{id})
	})
	if err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------- folders ----------

type adminFolder struct {
	library.Folder
	TrackCount int `json:"track_count"`
}

// listFolders returns a flat folder list. ?owner=shared (default) for CMS
// folders, or ?owner=<user id> to browse a user's personal library.
func (s *Server) listFolders(w http.ResponseWriter, r *http.Request) {
	where, args := "f.owner_user_id IS NULL", []any{}
	if o := r.URL.Query().Get("owner"); o != "" && o != "shared" {
		uid, err := strconv.ParseInt(o, 10, 64)
		if err != nil {
			badID(w)
			return
		}
		where, args = "f.owner_user_id = ?", append(args, uid)
	}
	rows, err := s.DB.QueryContext(r.Context(), `
		SELECT f.id, f.owner_user_id, f.parent_id, f.name, f.sort_order, f.sort_mode, f.auto_download, f.rev, f.updated_at, FALSE,
			(SELECT COUNT(*) FROM folder_tracks ft WHERE ft.folder_id = f.id AND ft.deleted_at IS NULL)
		FROM folders f WHERE f.deleted_at IS NULL AND `+where+` ORDER BY f.sort_order, f.name`, args...)
	if err != nil {
		fail(w, err)
		return
	}
	defer rows.Close()
	out := []adminFolder{}
	for rows.Next() {
		var f adminFolder
		var owner, parent sql.NullInt64
		var updated time.Time
		if err := rows.Scan(&f.ID, &owner, &parent, &f.Name, &f.SortOrder, &f.SortMode, &f.AutoDownload, &f.Rev, &updated, &f.Deleted, &f.TrackCount); err != nil {
			fail(w, err)
			return
		}
		if owner.Valid {
			f.OwnerUserID = &owner.Int64
		}
		if parent.Valid {
			f.ParentID = &parent.Int64
		}
		f.UpdatedAt = updated.UnixMilli()
		out = append(out, f)
	}
	writeJSON(w, http.StatusOK, out)
}

// sharedFolder loads a live CMS folder (owner NULL) or fails.
func (s *Server) sharedFolder(ctx context.Context, ex db.Execer, id int64) (library.Folder, error) {
	f, err := s.Lib.GetFolder(ctx, ex, id)
	if err != nil {
		return f, err
	}
	if f.Deleted {
		return f, library.ErrNotFound
	}
	if f.OwnerUserID != nil {
		return f, library.ErrForbidden
	}
	return f, nil
}

func (s *Server) createAdminFolder(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name     string `json:"name"`
		ParentID *int64 `json:"parent_id"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	ctx := r.Context()
	var id int64
	err := db.WithTx(ctx, s.DB, func(tx *sql.Tx) error {
		if in.ParentID != nil {
			if _, err := s.sharedFolder(ctx, tx, *in.ParentID); err != nil {
				return err
			}
		}
		var err error
		id, err = s.Lib.CreateFolder(ctx, tx, nil, in.ParentID, in.Name)
		return err
	})
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]int64{"id": id})
}

func (s *Server) updateAdminFolder(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(r, "id")
	if !ok {
		badID(w)
		return
	}
	var in struct {
		Name      *string `json:"name"`
		ParentID  *int64  `json:"parent_id"`
		ToRoot    bool    `json:"to_root"`
		SortOrder *int    `json:"sort_order"`
		SortMode  *string `json:"sort_mode"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	ctx := r.Context()
	err := db.WithTx(ctx, s.DB, func(tx *sql.Tx) error {
		if _, err := s.sharedFolder(ctx, tx, id); err != nil {
			return err
		}
		sets, args := []string{}, []any{}
		moved := false
		if in.Name != nil {
			if strings.TrimSpace(*in.Name) == "" {
				return library.ErrInvalid
			}
			sets, args = append(sets, "name = ?"), append(args, strings.TrimSpace(*in.Name))
		}
		if in.ToRoot {
			sets, moved = append(sets, "parent_id = NULL"), true
		} else if in.ParentID != nil {
			if _, err := s.sharedFolder(ctx, tx, *in.ParentID); err != nil {
				return err
			}
			inside, err := s.Lib.IsDescendant(ctx, tx, id, *in.ParentID)
			if err != nil {
				return err
			}
			if inside {
				return errors.Join(library.ErrInvalid, errors.New("cannot move a folder into itself"))
			}
			sets, args, moved = append(sets, "parent_id = ?"), append(args, *in.ParentID), true
		}
		if in.SortOrder != nil {
			sets, args = append(sets, "sort_order = ?"), append(args, *in.SortOrder)
		}
		if in.SortMode != nil {
			sets, args = append(sets, "sort_mode = ?"), append(args, *in.SortMode)
		}
		if len(sets) == 0 {
			return nil
		}
		rev, err := db.NextRev(ctx, tx)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE folders SET `+strings.Join(sets, ", ")+`, rev = ?, updated_at = NOW(3) WHERE id = ?`,
			append(args, rev, id)...); err != nil {
			return err
		}
		if moved { // its audience may have changed with its new ancestors
			return s.Lib.BumpSubtree(ctx, tx, id)
		}
		return nil
	})
	if err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) deleteAdminFolder(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(r, "id")
	if !ok {
		badID(w)
		return
	}
	ctx := r.Context()
	err := db.WithTx(ctx, s.DB, func(tx *sql.Tx) error {
		if _, err := s.sharedFolder(ctx, tx, id); err != nil {
			return err
		}
		return s.Lib.DeleteFolder(ctx, tx, id)
	})
	if err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type adminTrack struct {
	ItemID int64 `json:"item_id,omitempty"`
	library.Track
	CreatedAt int64 `json:"created_at"`
}

const trackCols = `t.id, t.title, t.artist, t.album, t.duration_ms, t.size_bytes, t.mime, t.cover_key IS NOT NULL, t.source, COALESCE(t.source_url, ''), t.rev, t.created_at`

func scanAdminTrack(rows *sql.Rows, withItem bool) (adminTrack, error) {
	var t adminTrack
	var created time.Time
	dest := []any{&t.ID, &t.Title, &t.Artist, &t.Album, &t.DurationMs, &t.SizeBytes, &t.Mime, &t.HasCover, &t.Source, &t.SourceURL, &t.Rev, &created}
	if withItem {
		dest = append([]any{&t.ItemID}, dest...)
	}
	err := rows.Scan(dest...)
	t.CreatedAt = created.UnixMilli()
	return t, err
}

func (s *Server) folderTracks(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(r, "id")
	if !ok {
		badID(w)
		return
	}
	rows, err := s.DB.QueryContext(r.Context(), `
		SELECT ft.id, `+trackCols+` FROM folder_tracks ft JOIN tracks t ON t.id = ft.track_id
		WHERE ft.folder_id = ? AND ft.deleted_at IS NULL ORDER BY ft.sort_order, ft.id`, id)
	if err != nil {
		fail(w, err)
		return
	}
	defer rows.Close()
	out := []adminTrack{}
	for rows.Next() {
		t, err := scanAdminTrack(rows, true)
		if err != nil {
			fail(w, err)
			return
		}
		out = append(out, t)
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) addTracksToFolder(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(r, "id")
	if !ok {
		badID(w)
		return
	}
	var in struct {
		TrackIDs []int64 `json:"track_ids"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	ctx := r.Context()
	err := db.WithTx(ctx, s.DB, func(tx *sql.Tx) error {
		if _, err := s.sharedFolder(ctx, tx, id); err != nil {
			return err
		}
		for _, t := range in.TrackIDs {
			if _, err := s.Lib.AttachTrack(ctx, tx, id, t); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) reorderFolderTracks(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(r, "id")
	if !ok {
		badID(w)
		return
	}
	var in struct {
		ItemIDs []int64 `json:"item_ids"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	ctx := r.Context()
	err := db.WithTx(ctx, s.DB, func(tx *sql.Tx) error {
		if _, err := s.sharedFolder(ctx, tx, id); err != nil {
			return err
		}
		return s.Lib.ReorderItems(ctx, tx, id, in.ItemIDs)
	})
	if err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) removeFolderTrack(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(r, "id")
	item, ok2 := idParam(r, "itemId")
	if !ok || !ok2 {
		badID(w)
		return
	}
	ctx := r.Context()
	err := db.WithTx(ctx, s.DB, func(tx *sql.Tx) error {
		if _, err := s.sharedFolder(ctx, tx, id); err != nil {
			return err
		}
		var folder int64
		if err := tx.QueryRowContext(ctx, `SELECT folder_id FROM folder_tracks WHERE id = ?`, item).Scan(&folder); err != nil {
			return err
		}
		if folder != id {
			return library.ErrNotFound
		}
		return s.Lib.DeleteItem(ctx, tx, item)
	})
	if err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// uploadToFolder streams each uploaded file (audio or .zip) into an import job.
func (s *Server) uploadToFolder(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(r, "id")
	if !ok {
		badID(w)
		return
	}
	ctx := r.Context()
	if _, err := s.sharedFolder(ctx, s.DB, id); err != nil {
		fail(w, err)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, s.MaxUpload)
	mr, err := r.MultipartReader()
	if err != nil {
		writeErr(w, http.StatusBadRequest, "expected multipart/form-data")
		return
	}
	jobIDs := []int64{}
	skipped := []string{}
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			fail(w, err)
			return
		}
		name := filepath.Base(part.FileName())
		if part.FileName() == "" {
			continue
		}
		if !library.IsAudio(name) && !strings.EqualFold(filepath.Ext(name), ".zip") {
			skipped = append(skipped, name)
			continue
		}
		jid, err := s.Jobs.EnqueueImport(ctx, id, name, part)
		if err != nil {
			fail(w, err)
			return
		}
		jobIDs = append(jobIDs, jid)
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"job_ids": jobIDs, "skipped": skipped})
}

func (s *Server) getAccess(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(r, "id")
	if !ok {
		badID(w)
		return
	}
	rows, err := s.DB.QueryContext(r.Context(), `SELECT user_id, group_id FROM folder_access WHERE folder_id = ?`, id)
	if err != nil {
		fail(w, err)
		return
	}
	defer rows.Close()
	out := map[string][]int64{"user_ids": {}, "group_ids": {}}
	for rows.Next() {
		var u, g sql.NullInt64
		if err := rows.Scan(&u, &g); err != nil {
			fail(w, err)
			return
		}
		if u.Valid {
			out["user_ids"] = append(out["user_ids"], u.Int64)
		}
		if g.Valid {
			out["group_ids"] = append(out["group_ids"], g.Int64)
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) setAccess(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(r, "id")
	if !ok {
		badID(w)
		return
	}
	var in struct {
		UserIDs  []int64 `json:"user_ids"`
		GroupIDs []int64 `json:"group_ids"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	ctx := r.Context()
	err := db.WithTx(ctx, s.DB, func(tx *sql.Tx) error {
		if _, err := s.sharedFolder(ctx, tx, id); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM folder_access WHERE folder_id = ?`, id); err != nil {
			return err
		}
		for _, u := range in.UserIDs {
			if _, err := tx.ExecContext(ctx, `INSERT INTO folder_access (folder_id, user_id) VALUES (?, ?)`, id, u); err != nil {
				return err
			}
		}
		for _, g := range in.GroupIDs {
			if _, err := tx.ExecContext(ctx, `INSERT INTO folder_access (folder_id, group_id) VALUES (?, ?)`, id, g); err != nil {
				return err
			}
		}
		return s.Lib.BumpSubtree(ctx, tx, id)
	})
	if err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------- tracks ----------

func (s *Server) searchTracks(w http.ResponseWriter, r *http.Request) {
	q := "%" + strings.TrimSpace(r.URL.Query().Get("q")) + "%"
	rows, err := s.DB.QueryContext(r.Context(), `
		SELECT `+trackCols+` FROM tracks t
		WHERE t.title LIKE ? OR t.artist LIKE ? OR t.album LIKE ?
		ORDER BY t.id DESC LIMIT 200`, q, q, q)
	if err != nil {
		fail(w, err)
		return
	}
	defer rows.Close()
	out := []adminTrack{}
	for rows.Next() {
		t, err := scanAdminTrack(rows, false)
		if err != nil {
			fail(w, err)
			return
		}
		out = append(out, t)
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) updateTrack(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(r, "id")
	if !ok {
		badID(w)
		return
	}
	var in struct {
		Title  *string `json:"title"`
		Artist *string `json:"artist"`
		Album  *string `json:"album"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	sets, args := []string{}, []any{}
	if in.Title != nil {
		if strings.TrimSpace(*in.Title) == "" {
			writeErr(w, http.StatusBadRequest, "title cannot be empty")
			return
		}
		sets, args = append(sets, "title = ?"), append(args, strings.TrimSpace(*in.Title))
	}
	if in.Artist != nil {
		sets, args = append(sets, "artist = ?"), append(args, strings.TrimSpace(*in.Artist))
	}
	if in.Album != nil {
		sets, args = append(sets, "album = ?"), append(args, strings.TrimSpace(*in.Album))
	}
	if len(sets) == 0 {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	ctx := r.Context()
	err := db.WithTx(ctx, s.DB, func(tx *sql.Tx) error {
		rev, err := db.NextRev(ctx, tx)
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `UPDATE tracks SET `+strings.Join(sets, ", ")+`, rev = ? WHERE id = ?`, append(args, rev, id)...)
		return err
	})
	if err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) adminTrackURL(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(r, "id")
	if !ok {
		badID(w)
		return
	}
	s.writeTrackURL(w, r, id)
}

// ---------- jobs ----------

func (s *Server) listImports(w http.ResponseWriter, r *http.Request) {
	out, err := s.Jobs.ListImports(r.Context(), 100)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) getImport(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(r, "id")
	if !ok {
		badID(w)
		return
	}
	j, err := s.Jobs.GetImport(r.Context(), id)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, j)
}

func (s *Server) listYouTubeJobs(w http.ResponseWriter, r *http.Request) {
	out, err := s.Jobs.ListYouTubeJobs(r.Context(), 200)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}
