package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"time"

	"mume/server/internal/ai"
	"mume/server/internal/auth"
	"mume/server/internal/library"
)

// ---------- play reporting ----------

func (s *Server) recordPlays(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Plays []library.PlayDelta `json:"plays"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if len(in.Plays) > 2000 {
		writeErr(w, http.StatusBadRequest, "too many entries")
		return
	}
	if err := s.Lib.RecordPlays(r.Context(), auth.FromContext(r.Context()).UserID, in.Plays); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------- recommendations ----------

const recsTTL = 6 * time.Hour

type recResponse struct {
	Sections    []ai.Section `json:"sections"`
	AI          bool         `json:"ai"`
	GeneratedAt int64        `json:"generated_at"`
}

var fallbackTitles = map[string][2]string{
	"ar": {"المزيد من فنانيك المفضلين", "اكتشف شيئاً جديداً"},
	"en": {"More from your favorite artists", "Discover something new"},
}

// recommendations builds the "For you" shelves. Gemini picks and names them from
// the songs the user can see; without a key (or if Gemini fails) a simple
// artist-based version is returned so the app always has something to show.
func (s *Server) recommendations(w http.ResponseWriter, r *http.Request) {
	lang := r.URL.Query().Get("lang")
	if _, ok := ai.LangName(lang); !ok {
		lang = "en"
	}
	ctx := r.Context()
	userID := auth.FromContext(ctx).UserID
	now := time.Now().UnixMilli()
	refresh := r.URL.Query().Get("refresh") == "1"

	cached, fresh, err := s.Lib.CachedRecommendations(ctx, userID, lang, recsTTL.Milliseconds(), now)
	if err != nil {
		fail(w, err)
		return
	}
	if fresh && !refresh && cached != "" {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(cached))
		return
	}

	taste, cands, err := s.Lib.TasteAndCandidates(ctx, userID, 250)
	if err != nil {
		fail(w, err)
		return
	}
	resp := recResponse{Sections: []ai.Section{}, GeneratedAt: now}
	if len(cands) >= 6 {
		if s.AI.Enabled() {
			t := make([]ai.TasteItem, len(taste))
			for i, x := range taste {
				t[i] = ai.TasteItem{Title: x.Title, Artist: x.Artist, Plays: x.Plays}
			}
			c := make([]ai.Candidate, len(cands))
			for i, x := range cands {
				c[i] = ai.Candidate{ID: x.ID, Title: x.Title, Artist: x.Artist}
			}
			sections, err := s.AI.Recommend(ctx, t, c, lang)
			if err != nil {
				log.Printf("recommendations for user %d: %v", userID, err)
			} else {
				resp.Sections, resp.AI = sections, true
			}
		}
		if !resp.AI {
			titles := fallbackTitles[lang]
			for _, sh := range library.ArtistShelf(taste, cands, titles[0], titles[1], 12) {
				resp.Sections = append(resp.Sections, ai.Section{Title: sh[0].(string), Reason: sh[1].(string), TrackIDs: sh[2].([]int64)})
			}
		}
	}

	raw, _ := json.Marshal(resp)
	// A failed AI call is not cached, so the next open tries again instead of serving the plain version for hours.
	if resp.AI || len(resp.Sections) == 0 && !s.AI.Enabled() {
		if err := s.Lib.SaveRecommendations(ctx, userID, lang, string(raw), now); err != nil {
			log.Printf("save recommendations: %v", err)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(raw)
}

// ---------- admin statistics ----------

func statsDays(r *http.Request) int {
	d, _ := strconv.Atoi(r.URL.Query().Get("days"))
	switch d {
	case 7, 30, 90:
		return d
	}
	return 30
}

func (s *Server) adminOverview(w http.ResponseWriter, r *http.Request) {
	o, err := s.Lib.Overview(r.Context(), statsDays(r))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, o)
}

func (s *Server) adminUserActivity(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(r, "id")
	if !ok {
		badID(w)
		return
	}
	a, err := s.Lib.Activity(r.Context(), id, statsDays(r))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, a)
}
