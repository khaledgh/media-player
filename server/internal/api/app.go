package api

import (
	"database/sql"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"mume/server/internal/auth"
	"mume/server/internal/db"
	"mume/server/internal/library"
)

// ---------- auth ----------

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email      string `json:"email"`
		Password   string `json:"password"`
		DeviceName string `json:"device_name"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	t, err := s.Auth.Login(r.Context(), in.Email, in.Password, in.DeviceName)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (s *Server) refresh(w http.ResponseWriter, r *http.Request) {
	var in struct {
		RefreshToken string `json:"refresh_token"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	t, err := s.Auth.Refresh(r.Context(), in.RefreshToken)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	var in struct {
		RefreshToken string `json:"refresh_token"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if err := s.Auth.Logout(r.Context(), in.RefreshToken); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	var u auth.User
	err := s.DB.QueryRowContext(r.Context(), `SELECT id, email, name, role FROM users WHERE id = ? AND disabled = FALSE`,
		auth.FromContext(r.Context()).UserID).Scan(&u.ID, &u.Email, &u.Name, &u.Role)
	if err == sql.ErrNoRows {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, u)
}

// ---------- sync ----------

func (s *Server) syncPull(w http.ResponseWriter, r *http.Request) {
	since, _ := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64)
	res, err := s.Lib.Pull(r.Context(), auth.FromContext(r.Context()).UserID, since)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) syncPush(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Ops []library.Op `json:"ops"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if len(in.Ops) > 1000 {
		writeErr(w, http.StatusBadRequest, "too many ops in one batch (max 1000)")
		return
	}
	writeJSON(w, http.StatusOK, s.Lib.Push(r.Context(), auth.FromContext(r.Context()).UserID, in.Ops))
}

// ---------- tracks ----------

func (s *Server) trackURL(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(r, "id")
	if !ok {
		badID(w)
		return
	}
	p := auth.FromContext(r.Context())
	if !p.IsAdmin() {
		visible, err := s.Lib.CanSeeTrack(r.Context(), p.UserID, id)
		if err != nil {
			fail(w, err)
			return
		}
		if !visible {
			fail(w, library.ErrNotFound)
			return
		}
	}
	s.writeTrackURL(w, r, id)
}

func (s *Server) writeTrackURL(w http.ResponseWriter, r *http.Request, id int64) {
	obj, cover, err := s.Lib.TrackKeys(r.Context(), id)
	if err != nil {
		fail(w, err)
		return
	}
	u, err := s.Store.URL(r.Context(), obj, urlTTL)
	if err != nil {
		fail(w, err)
		return
	}
	out := map[string]any{"url": u, "expires_in": int(urlTTL.Seconds())}
	if cover != "" {
		if cu, err := s.Store.URL(r.Context(), cover, urlTTL); err == nil {
			out["cover_url"] = cu
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// uploadTrack stores a file the user imported on their device so it syncs to
// their other devices. Query: folder_id, optional title. Body: multipart with a "file" part.
func (s *Server) uploadTrack(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := auth.FromContext(ctx).UserID
	folderID, _ := strconv.ParseInt(r.URL.Query().Get("folder_id"), 10, 64)
	f, err := s.Lib.GetFolder(ctx, s.DB, folderID)
	if err != nil {
		fail(w, err)
		return
	}
	if f.Deleted || f.OwnerUserID == nil || *f.OwnerUserID != userID {
		fail(w, library.ErrForbidden)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, s.MaxUpload)
	mr, err := r.MultipartReader()
	if err != nil {
		writeErr(w, http.StatusBadRequest, "expected multipart/form-data")
		return
	}
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			writeErr(w, http.StatusBadRequest, `missing "file" part`)
			return
		}
		if err != nil {
			fail(w, err)
			return
		}
		if part.FormName() != "file" || part.FileName() == "" {
			continue
		}
		name := filepath.Base(part.FileName())
		if !library.IsAudio(name) {
			writeErr(w, http.StatusBadRequest, "unsupported file type")
			return
		}
		tmp, err := os.CreateTemp("", "mume-up-*"+filepath.Ext(name))
		if err != nil {
			fail(w, err)
			return
		}
		defer os.Remove(tmp.Name())
		_, err = io.Copy(tmp, part)
		tmp.Close()
		if err != nil {
			fail(w, err)
			return
		}
		trackID, err := s.Lib.Ingest(ctx, library.IngestInput{
			Path: tmp.Name(), FileName: name, Source: "upload",
			FallbackTitle: strings.TrimSpace(r.URL.Query().Get("title")),
		})
		if err != nil {
			fail(w, err)
			return
		}
		var itemID int64
		err = db.WithTx(ctx, s.DB, func(tx *sql.Tx) error {
			itemID, err = s.Lib.AttachTrack(ctx, tx, folderID, trackID)
			return err
		})
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]int64{"track_id": trackID, "item_id": itemID})
		return
	}
}

// ---------- YouTube ----------

func (s *Server) createYouTube(w http.ResponseWriter, r *http.Request) {
	var in struct {
		URL      string `json:"url"`
		FolderID int64  `json:"folder_id"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	ctx := r.Context()
	userID := auth.FromContext(ctx).UserID
	f, err := s.Lib.GetFolder(ctx, s.DB, in.FolderID)
	if err != nil {
		fail(w, err)
		return
	}
	if f.Deleted || f.OwnerUserID == nil || *f.OwnerUserID != userID {
		fail(w, library.ErrForbidden)
		return
	}
	id, err := s.Jobs.EnqueueYouTube(ctx, userID, in.FolderID, in.URL)
	if err != nil {
		fail(w, err)
		return
	}
	j, err := s.Jobs.GetYouTubeJob(ctx, id)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, j)
}

func (s *Server) getYouTube(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(r, "id")
	if !ok {
		badID(w)
		return
	}
	j, err := s.Jobs.GetYouTubeJob(r.Context(), id)
	if err == nil && j.UserID != auth.FromContext(r.Context()).UserID {
		err = library.ErrNotFound
	}
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, j)
}
