package api

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	"mume/server/internal/ai"
	"mume/server/internal/auth"
	"mume/server/internal/db"
	"mume/server/internal/library"
)

// ---------- AI name suggestions ----------

// suggestNames asks Gemini for cleaner names. It never writes anything: the
// client shows the result for review and applies it with a normal update.
// Non-admins may only ask about tracks they can see.
func (s *Server) suggestNames(w http.ResponseWriter, r *http.Request) {
	var in struct {
		TrackIDs []int64 `json:"track_ids"`
		Lang     string  `json:"lang"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if _, ok := ai.LangName(in.Lang); !ok {
		writeErr(w, http.StatusBadRequest, `lang must be "ar" or "en"`)
		return
	}
	if len(in.TrackIDs) == 0 || len(in.TrackIDs) > 100 {
		writeErr(w, http.StatusBadRequest, "send between 1 and 100 track_ids")
		return
	}
	if !s.AI.Enabled() {
		writeErr(w, http.StatusServiceUnavailable, ai.ErrDisabled.Error())
		return
	}
	ctx := r.Context()
	p := auth.FromContext(ctx)
	if !p.IsAdmin() {
		for _, id := range in.TrackIDs {
			ok, err := s.Lib.CanSeeTrack(ctx, p.UserID, id)
			if err != nil {
				fail(w, err)
				return
			}
			if !ok {
				fail(w, library.ErrNotFound)
				return
			}
		}
	}
	metas, err := s.Lib.TrackMetas(ctx, in.TrackIDs)
	if err != nil {
		fail(w, err)
		return
	}
	items := make([]ai.Item, len(metas))
	old := make(map[int64]library.TrackMeta, len(metas))
	for i, m := range metas {
		items[i] = ai.Item{ID: m.ID, Title: m.Title, Artist: m.Artist}
		old[m.ID] = m
	}
	sug, err := s.AI.Suggest(ctx, items, in.Lang)
	if err != nil {
		if errors.Is(err, ai.ErrDisabled) {
			writeErr(w, http.StatusServiceUnavailable, err.Error())
			return
		}
		writeErr(w, http.StatusBadGateway, "AI request failed: "+err.Error())
		return
	}
	type row struct {
		ID         int64  `json:"id"`
		OldTitle   string `json:"old_title"`
		OldArtist  string `json:"old_artist"`
		Title      string `json:"title"`
		Artist     string `json:"artist"`
		Confidence string `json:"confidence"`
	}
	out := make([]row, 0, len(sug))
	for _, x := range sug {
		o := old[x.ID]
		out = append(out, row{x.ID, o.Title, o.Artist, x.Title, x.Artist, x.Confidence})
	}
	writeJSON(w, http.StatusOK, out)
}

// userUpdateTrack lets a user rename a track that lives in one of their own folders.
func (s *Server) userUpdateTrack(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(r, "id")
	if !ok {
		badID(w)
		return
	}
	var in struct {
		Title  string `json:"title"`
		Artist string `json:"artist"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.Title) == "" {
		writeErr(w, http.StatusBadRequest, "title cannot be empty")
		return
	}
	ctx := r.Context()
	ok, err := s.Lib.CanEditTrack(ctx, auth.FromContext(ctx).UserID, id)
	if err != nil {
		fail(w, err)
		return
	}
	if !ok {
		fail(w, library.ErrForbidden)
		return
	}
	err = db.WithTx(ctx, s.DB, func(tx *sql.Tx) error { return s.Lib.SetTrackMeta(ctx, tx, id, in.Title, in.Artist) })
	if err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------- favorites ----------

func (s *Server) getFavorites(w http.ResponseWriter, r *http.Request) {
	f, err := s.Lib.GetFavorites(r.Context(), auth.FromContext(r.Context()).UserID)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, f)
}

func (s *Server) pushFavorites(w http.ResponseWriter, r *http.Request) {
	var in library.Favorites
	if !readJSON(w, r, &in) {
		return
	}
	if len(in.Folders)+len(in.Items) > 5000 {
		writeErr(w, http.StatusBadRequest, "too many changes in one batch")
		return
	}
	refs, err := s.Lib.PushFavorites(r.Context(), auth.FromContext(r.Context()).UserID, in)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"folders": refs})
}

// ---------- download history ----------

func (s *Server) recordDownloads(w http.ResponseWriter, r *http.Request) {
	var in struct {
		TrackIDs []int64 `json:"track_ids"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if len(in.TrackIDs) > 1000 {
		writeErr(w, http.StatusBadRequest, "too many track_ids")
		return
	}
	if err := s.Lib.RecordDownloads(r.Context(), auth.FromContext(r.Context()).UserID, in.TrackIDs, time.Now().UnixMilli()); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listDownloads(w http.ResponseWriter, r *http.Request) {
	ids, err := s.Lib.DownloadedTrackIDs(r.Context(), auth.FromContext(r.Context()).UserID)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"track_ids": ids})
}
