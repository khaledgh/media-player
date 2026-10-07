package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"sync/atomic"
	"testing"
	"time"

	"mume/server/internal/ai"
	"mume/server/internal/auth"
	"mume/server/internal/jobs"
	"mume/server/internal/library"
	"mume/server/internal/storage"
)

func TestAIFavoritesAndDownloads(t *testing.T) {
	conn := testDB(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	nodeYT := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Video-Title", "fairuz%20ya%20tair%20official%20video")
		w.Header().Set("X-Video-Duration", "61")
		fmt.Fprintf(w, "fake-mp3-%s", r.URL.Query().Get("url"))
	}))
	defer nodeYT.Close()
	// Fake Gemini: answers for whatever ids it is asked about.
	var highConf atomic.Bool
	gemini := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !highConf.Load() {
			w.Write([]byte(`{"candidates":[{"content":{"parts":[{"text":"[]"}]}}]}`))
			return
		}
		body, _ := io.ReadAll(r.Body)
		m := regexp.MustCompile(`\\"id\\":(\d+)`).FindSubmatch(body)
		answer := fmt.Sprintf(`[{"id":%s,"title":"يا طير","artist":"فيروز","confidence":"high"}]`, m[1])
		resp, _ := json.Marshal(map[string]any{"candidates": []any{map[string]any{"content": map[string]any{"parts": []any{map[string]string{"text": answer}}}}}})
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
	runner := &jobs.Runner{DB: conn, Lib: lib, NodeYTURL: nodeYT.URL, Workers: 1, AI: aiClient}
	runner.Start(ctx)
	s := &Server{
		DB: conn, Lib: lib, Jobs: runner, Store: local, AI: aiClient, MaxUpload: 50 << 20,
		Auth: &auth.Service{DB: conn, Secret: []byte("secret"), AccessTTL: time.Hour, RefreshTTL: time.Hour},
	}
	mux.Handle("/", s.Router())
	e := &env{t: t, srv: ts}

	hash, _ := auth.HashPassword("pass12345")
	conn.Exec(`INSERT INTO users (email, name, password_hash, role) VALUES ('u@x.io', 'U', ?, 'user')`, hash)
	user := e.login("u@x.io", "pass12345")

	var created struct{ ID int64 }
	name := "Mine"
	var push library.PushResult
	e.do("POST", "/api/v1/sync/push", user, map[string]any{"ops": []library.Op{{Op: "folder.upsert", Ref: "c1", Name: &name}}}, &push)
	mine := push.Folders["c1"]

	// The Gemini fake answers [] so names stay unchanged (low confidence): no artist folder yet.
	var job jobs.YouTubeJob
	if c := e.do("POST", "/api/v1/youtube", user, map[string]any{"url": "https://youtu.be/dQw4w9WgXcQ", "folder_id": mine, "ai_lang": "ar"}, &job); c != 202 {
		t.Fatalf("youtube: %d", c)
	}
	waitFor(t, "youtube job", func() bool {
		e.do("GET", fmt.Sprintf("/api/v1/youtube/%d", job.ID), user, nil, &job)
		return job.Status == "done" || job.Status == "error"
	})
	if job.Status != "done" || job.TrackID == nil {
		t.Fatalf("job: %+v", job)
	}
	trackID := *job.TrackID

	// ai-suggest returns a review list and never writes.
	var sug []struct {
		ID         int64
		OldTitle   string `json:"old_title"`
		Confidence string
	}
	if c := e.do("POST", "/api/v1/tracks/ai-suggest", user, map[string]any{"track_ids": []int64{trackID}, "lang": "ar"}, &sug); c != 200 || len(sug) != 1 || sug[0].Confidence != "low" {
		t.Fatalf("suggest: %d %+v", c, sug)
	}
	if c := e.do("POST", "/api/v1/tracks/ai-suggest", user, map[string]any{"track_ids": []int64{trackID}, "lang": "fr"}, nil); c != 400 {
		t.Fatalf("bad lang: %d", c)
	}
	if c := e.do("POST", "/api/v1/tracks/ai-suggest", user, map[string]any{"track_ids": []int64{999999}, "lang": "ar"}, nil); c != 404 {
		t.Fatalf("suggest for an invisible track: %d", c)
	}

	// The user can rename a track in their own folder; the change bumps its revision.
	var before int64
	conn.QueryRow(`SELECT rev FROM tracks WHERE id = ?`, trackID).Scan(&before)
	if c := e.do("PATCH", fmt.Sprintf("/api/v1/tracks/%d", trackID), user, map[string]string{"title": "يا طير", "artist": "فيروز"}, nil); c != 204 {
		t.Fatalf("rename: %d", c)
	}
	var title, artist string
	var after int64
	conn.QueryRow(`SELECT title, artist, rev FROM tracks WHERE id = ?`, trackID).Scan(&title, &artist, &after)
	if title != "يا طير" || artist != "فيروز" || after <= before {
		t.Fatalf("after rename: %q %q rev %d->%d", title, artist, before, after)
	}
	// Someone with no folder holding the track cannot rename it.
	conn.Exec(`INSERT INTO users (email, name, password_hash, role) VALUES ('o@x.io', 'O', ?, 'user')`, hash)
	other := e.login("o@x.io", "pass12345")
	if c := e.do("PATCH", fmt.Sprintf("/api/v1/tracks/%d", trackID), other, map[string]string{"title": "x"}, nil); c != 403 {
		t.Fatalf("foreign rename: %d", c)
	}

	// Favorites: create a folder by ref, put the track in it, then pull from "another device".
	now := time.Now().UnixMilli()
	var out struct{ Folders map[string]int64 }
	e.do("POST", "/api/v1/favorites/push", user, library.Favorites{
		Folders: []library.FavFolder{{Ref: "f1", Name: "Road trip", UpdatedAt: now}},
		Items:   []library.FavItem{{TrackID: trackID, FolderRef: "f1", AddedAt: now, UpdatedAt: now}},
	}, &out)
	if out.Folders["f1"] == 0 {
		t.Fatalf("favorite folder not created: %+v", out)
	}
	var fav library.Favorites
	e.do("GET", "/api/v1/favorites", user, nil, &fav)
	if len(fav.Folders) != 1 || len(fav.Items) != 1 || fav.Items[0].FolderID == nil || *fav.Items[0].FolderID != out.Folders["f1"] {
		t.Fatalf("favorites: %+v", fav)
	}
	// An older change loses, a newer one wins.
	e.do("POST", "/api/v1/favorites/push", user, library.Favorites{
		Items: []library.FavItem{{TrackID: trackID, Deleted: true, AddedAt: now, UpdatedAt: now - 1000}},
	}, nil)
	e.do("GET", "/api/v1/favorites", user, nil, &fav)
	if fav.Items[0].Deleted {
		t.Fatal("stale delete overwrote a newer favorite")
	}
	e.do("POST", "/api/v1/favorites/push", user, library.Favorites{
		Items: []library.FavItem{{TrackID: trackID, Deleted: true, AddedAt: now, UpdatedAt: now + 1000}},
	}, nil)
	e.do("GET", "/api/v1/favorites", user, nil, &fav)
	if !fav.Items[0].Deleted {
		t.Fatal("newer delete was ignored")
	}
	// Another user's favorites are separate.
	var otherFav library.Favorites
	e.do("GET", "/api/v1/favorites", other, nil, &otherFav)
	if len(otherFav.Items) != 0 || len(otherFav.Folders) != 0 {
		t.Fatalf("favorites leaked: %+v", otherFav)
	}

	// Download history: only tracks the user can see are remembered.
	e.do("POST", "/api/v1/downloads", user, map[string]any{"track_ids": []int64{trackID}}, nil)
	e.do("POST", "/api/v1/downloads", other, map[string]any{"track_ids": []int64{trackID}}, nil)
	var dl struct {
		TrackIDs []int64 `json:"track_ids"`
	}
	e.do("GET", "/api/v1/downloads", user, nil, &dl)
	if len(dl.TrackIDs) != 1 || dl.TrackIDs[0] != trackID {
		t.Fatalf("downloads: %+v", dl)
	}
	e.do("GET", "/api/v1/downloads", other, nil, &dl)
	if len(dl.TrackIDs) != 0 {
		t.Fatalf("downloads leaked to a user who cannot see the track: %+v", dl)
	}
	_ = created

	// With a confident AI answer, a fresh download is renamed and filed under the artist's folder.
	highConf.Store(true)
	var job2 jobs.YouTubeJob
	e.do("POST", "/api/v1/youtube", user, map[string]any{"url": "https://youtu.be/aaaaaaaaaaa", "folder_id": mine, "ai_lang": "ar"}, &job2)
	waitFor(t, "ai youtube job", func() bool {
		e.do("GET", fmt.Sprintf("/api/v1/youtube/%d", job2.ID), user, nil, &job2)
		return job2.Status == "done" || job2.Status == "error"
	})
	if job2.Status != "done" || job2.TrackID == nil {
		t.Fatalf("ai job: %+v", job2)
	}
	var inFolder string
	conn.QueryRow(`SELECT f.name FROM folder_tracks ft JOIN folders f ON f.id = ft.folder_id WHERE ft.track_id = ? AND f.parent_id IS NULL`, *job2.TrackID).Scan(&inFolder)
	conn.QueryRow(`SELECT title, artist FROM tracks WHERE id = ?`, *job2.TrackID).Scan(&title, &artist)
	if inFolder != "فيروز" || title != "يا طير" || artist != "فيروز" {
		t.Fatalf("ai ingest: folder=%q title=%q artist=%q", inFolder, title, artist)
	}
	// A second song by the same artist reuses that folder.
	e.do("POST", "/api/v1/youtube", user, map[string]any{"url": "https://youtu.be/bbbbbbbbbbb", "folder_id": mine, "ai_lang": "ar"}, &job2)
	waitFor(t, "second ai job", func() bool {
		e.do("GET", fmt.Sprintf("/api/v1/youtube/%d", job2.ID), user, nil, &job2)
		return job2.Status == "done" || job2.Status == "error"
	})
	var folders int
	conn.QueryRow(`SELECT COUNT(*) FROM folders WHERE name = 'فيروز' AND deleted_at IS NULL`).Scan(&folders)
	if folders != 1 {
		t.Fatalf("expected one artist folder, got %d", folders)
	}
}
