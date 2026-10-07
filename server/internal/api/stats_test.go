package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"mume/server/internal/ai"
	"mume/server/internal/auth"
	"mume/server/internal/library"
	"mume/server/internal/storage"
)

func TestStatsAndRecommendations(t *testing.T) {
	conn := testDB(t)
	// Fake Gemini: recommends the first 4 candidate ids it can find in the prompt.
	var geminiUp = true
	gemini := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !geminiUp {
			http.Error(w, "down", 500)
			return
		}
		body, _ := io.ReadAll(r.Body)
		var req struct {
			Contents []struct {
				Parts []struct{ Text string } `json:"parts"`
			} `json:"contents"`
		}
		json.Unmarshal(body, &req)
		prompt := req.Contents[0].Parts[0].Text
		// The candidate list is the last JSON array in the prompt.
		var first []struct{ ID int64 }
		json.Unmarshal([]byte(prompt[lastArray(prompt):]), &first)
		ids := []int64{}
		for i := 0; i < 4 && i < len(first); i++ {
			ids = append(ids, first[i].ID)
		}
		answer, _ := json.Marshal([]map[string]any{{"title": "لأنك تحب فيروز", "reason": "r", "track_ids": append(ids, 987654)}})
		resp, _ := json.Marshal(map[string]any{"candidates": []any{map[string]any{"content": map[string]any{"parts": []any{map[string]string{"text": string(answer)}}}}}})
		w.Write(resp)
	}))
	defer gemini.Close()

	mux := http.NewServeMux()
	ts := httptest.NewServer(mux)
	defer ts.Close()
	local, err := storage.NewLocal(t.TempDir(), ts.URL, []byte("secret"))
	if err != nil {
		t.Fatal(err)
	}
	lib := &library.Library{DB: conn, Store: local}
	aiClient := &ai.Client{Key: "k", BaseURL: gemini.URL}
	s := &Server{
		DB: conn, Lib: lib, Store: local, AI: aiClient, MaxUpload: 50 << 20,
		Auth: &auth.Service{DB: conn, Secret: []byte("secret"), AccessTTL: time.Hour, RefreshTTL: time.Hour},
	}
	mux.Handle("/", s.Router())
	e := &env{t: t, srv: ts}

	hash, _ := auth.HashPassword("pass12345")
	conn.Exec(`INSERT INTO users (email, name, password_hash, role) VALUES ('admin@x.io', 'A', ?, 'admin')`, hash)
	conn.Exec(`INSERT INTO users (email, name, password_hash, role) VALUES ('u@x.io', 'U', ?, 'user')`, hash)
	admin := e.login("admin@x.io", "pass12345")
	user := e.login("u@x.io", "pass12345")
	var userID int64
	conn.QueryRow(`SELECT id FROM users WHERE email = 'u@x.io'`).Scan(&userID)

	// A user folder with 8 songs.
	name := "Mine"
	var push library.PushResult
	e.do("POST", "/api/v1/sync/push", user, map[string]any{"ops": []library.Op{{Op: "folder.upsert", Ref: "c1", Name: &name}}}, &push)
	folder := push.Folders["c1"]
	var ids []int64
	for i := 0; i < 8; i++ {
		artist := "Fairuz"
		if i >= 4 {
			artist = "Other"
		}
		res, _ := conn.Exec(`INSERT INTO tracks (sha256, object_key, title, artist, mime, rev) VALUES (?, 'k', ?, ?, 'audio/mpeg', 1)`, fmt.Sprintf("%064d", i), fmt.Sprintf("Song %d", i), artist)
		id, _ := res.LastInsertId()
		ids = append(ids, id)
		conn.Exec(`INSERT INTO folder_tracks (folder_id, track_id, rev) VALUES (?, ?, 1)`, folder, id)
	}

	// Cold start still gets a shelf (fallback has no taste, so just "discover").
	today := time.Now().Format("2006-01-02")
	yesterday := time.Now().AddDate(0, 0, -1).Format("2006-01-02")
	if c := e.do("POST", "/api/v1/plays", user, map[string]any{"plays": []library.PlayDelta{
		{TrackID: ids[0], Day: today, Count: 5, At: time.Now().UnixMilli()},
		{TrackID: ids[0], Day: yesterday, Count: 2, At: time.Now().UnixMilli() - 1000},
		{TrackID: ids[1], Day: today, Count: 1, At: time.Now().UnixMilli()},
		{TrackID: 424242, Day: today, Count: 9, At: 1}, // not visible: ignored
		{TrackID: ids[2], Day: "garbage", Count: 3, At: 1},
	}}, nil); c != 204 {
		t.Fatalf("plays: %d", c)
	}
	e.do("POST", "/api/v1/downloads", user, map[string]any{"track_ids": []int64{ids[0]}}, nil)
	e.do("POST", "/api/v1/downloads", user, map[string]any{"track_ids": []int64{ids[0]}}, nil)

	// Admin overview.
	var ov library.Overview
	if c := e.do("GET", "/api/v1/admin/stats/overview?days=7", admin, nil, &ov); c != 200 {
		t.Fatalf("overview: %d", c)
	}
	if ov.PlaysTotal != 8 || ov.PlaysPeriod != 8 || ov.Listeners != 1 || ov.Downloads != 2 || len(ov.Daily) != 7 {
		t.Fatalf("overview: %+v", ov)
	}
	if len(ov.TopTracks) != 2 || ov.TopTracks[0].ID != ids[0] || ov.TopTracks[0].Plays != 7 || ov.TopTracks[0].Downloads != 2 {
		t.Fatalf("top tracks: %+v", ov.TopTracks)
	}
	if len(ov.TopArtists) != 1 || ov.TopArtists[0].Artist != "Fairuz" || len(ov.TopUsers) == 0 || ov.TopUsers[0].Plays != 8 {
		t.Fatalf("top artists/users: %+v %+v", ov.TopArtists, ov.TopUsers)
	}
	if c := e.do("GET", "/api/v1/admin/stats/overview", user, nil, nil); c != 403 {
		t.Fatalf("overview for a user: %d", c)
	}

	// Per-user activity.
	var act library.UserActivity
	e.do("GET", fmt.Sprintf("/api/v1/admin/users/%d/activity", userID), admin, nil, &act)
	if act.PlaysTotal != 8 || act.UniqueTracks != 2 || act.Downloads != 2 || len(act.TopPlayed) != 2 || len(act.TopDownloaded) != 1 || act.TopDownloaded[0].ID != ids[0] {
		t.Fatalf("activity: %+v", act)
	}

	// AI recommendations: only candidate ids survive (987654 is dropped), and the result is cached.
	var rec struct {
		Sections []ai.Section
		AI       bool
	}
	if c := e.do("GET", "/api/v1/recommendations?lang=ar", user, nil, &rec); c != 200 || !rec.AI || len(rec.Sections) != 1 || len(rec.Sections[0].TrackIDs) != 4 {
		t.Fatalf("ai recs: %d %+v", c, rec)
	}
	geminiUp = false
	var cached struct{ AI bool }
	e.do("GET", "/api/v1/recommendations?lang=ar", user, nil, &cached)
	if !cached.AI {
		t.Fatal("recommendations were not served from the cache")
	}

	// With Gemini down and the cache bypassed, the artist-based fallback answers.
	var fb struct {
		Sections []ai.Section
		AI       bool
	}
	e.do("GET", "/api/v1/recommendations?lang=en&refresh=1", user, nil, &fb)
	if fb.AI || len(fb.Sections) == 0 {
		t.Fatalf("fallback: %+v", fb)
	}
}

// lastArray returns the index where the last top-level JSON array in s starts.
func lastArray(s string) int {
	depth, start := 0, 0
	for i, r := range s {
		switch r {
		case '[':
			if depth == 0 {
				start = i
			}
			depth++
		case ']':
			depth--
		}
	}
	return start
}
