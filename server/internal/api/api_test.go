package api

import (
	"archive/zip"
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"mume/server/internal/auth"
	"mume/server/internal/db"
	"mume/server/internal/jobs"
	"mume/server/internal/library"
	"mume/server/internal/storage"
)

// Integration tests need a MySQL database they may wipe.
// Default: root@localhost/mume_test; override with TEST_DB_DSN.
func testDB(t *testing.T) *sql.DB {
	t.Helper()
	dsn := os.Getenv("TEST_DB_DSN")
	if dsn == "" {
		dsn = "root@tcp(127.0.0.1:3306)/mume_test?parseTime=true&multiStatements=true&charset=utf8mb4"
	}
	conn, err := db.Open(dsn)
	if err != nil {
		t.Skipf("MySQL not available: %v", err)
	}
	ctx := context.Background()
	conn.ExecContext(ctx, `SET FOREIGN_KEY_CHECKS = 0`)
	rows, _ := conn.QueryContext(ctx, `SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()`)
	var tables []string
	for rows.Next() {
		var n string
		rows.Scan(&n)
		tables = append(tables, n)
	}
	rows.Close()
	for _, n := range tables {
		if _, err := conn.ExecContext(ctx, "DROP TABLE `"+n+"`"); err != nil {
			t.Fatal(err)
		}
	}
	conn.ExecContext(ctx, `SET FOREIGN_KEY_CHECKS = 1`)
	conn.SetMaxOpenConns(1) // keep the session-level FK setting predictable
	conn.SetMaxOpenConns(20)
	if err := db.Migrate(ctx, conn); err != nil {
		t.Fatal(err)
	}
	return conn
}

type env struct {
	t   *testing.T
	srv *httptest.Server
}

func (e *env) do(method, path, token string, body any, out any) int {
	e.t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, e.srv.URL+path, rd)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	if out != nil {
		json.NewDecoder(resp.Body).Decode(out)
	}
	return resp.StatusCode
}

func (e *env) login(email, pw string) string {
	e.t.Helper()
	var tok auth.Tokens
	if code := e.do("POST", "/api/v1/auth/login", "", map[string]string{"email": email, "password": pw, "device_name": "test"}, &tok); code != 200 {
		e.t.Fatalf("login %s: %d", email, code)
	}
	return tok.AccessToken
}

func (e *env) upload(path, token, field, name string, content []byte) int {
	e.t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, _ := mw.CreateFormFile(field, name)
	fw.Write(content)
	mw.Close()
	req, _ := http.NewRequest("POST", e.srv.URL+path, &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	resp.Body.Close()
	return resp.StatusCode
}

func waitFor(t *testing.T, what string, fn func() bool) {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		if fn() {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func zipBytes(files map[string]string) []byte {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for n, c := range files {
		w, _ := zw.Create(n)
		w.Write([]byte(c))
	}
	zw.Close()
	return buf.Bytes()
}

func TestEndToEnd(t *testing.T) {
	conn := testDB(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Fake node-yt: returns a distinct "mp3" per video and checks the internal key.
	var ytCalls int
	nodeYT := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Internal-Key") != "k" {
			http.Error(w, "nope", 401)
			return
		}
		ytCalls++
		w.Header().Set("X-Video-Title", "My%20Video")
		w.Header().Set("X-Video-Duration", "61")
		fmt.Fprintf(w, "fake-mp3-%s", r.URL.Query().Get("url"))
	}))
	defer nodeYT.Close()

	srvMux := http.NewServeMux()
	ts := httptest.NewServer(srvMux)
	defer ts.Close()
	local, err := storage.NewLocal(t.TempDir(), ts.URL, []byte("secret"))
	if err != nil {
		t.Fatal(err)
	}
	lib := &library.Library{DB: conn, Store: local}
	runner := &jobs.Runner{DB: conn, Lib: lib, NodeYTURL: nodeYT.URL, NodeYTKey: "k", Workers: 1}
	runner.Start(ctx)
	s := &Server{
		DB: conn, Lib: lib, Jobs: runner, Store: local, MaxUpload: 50 << 20, Files: local.Handler(),
		Auth: &auth.Service{DB: conn, Secret: []byte("secret"), AccessTTL: time.Hour, RefreshTTL: time.Hour},
	}
	srvMux.Handle("/", s.Router())
	e := &env{t: t, srv: ts}

	hash, _ := auth.HashPassword("adminpass1")
	conn.Exec(`INSERT INTO users (email, name, password_hash, role) VALUES ('admin@x.io', 'A', ?, 'admin')`, hash)
	admin := e.login("admin@x.io", "adminpass1")

	// --- CMS: users, group, shared folder, zip upload, access ---
	var created struct{ ID int64 }
	if c := e.do("POST", "/api/v1/admin/users", admin, map[string]any{"email": "Bob@x.io", "password": "bobpass12", "name": "Bob"}, &created); c != 201 {
		t.Fatalf("create user: %d", c)
	}
	bobID := created.ID
	if c := e.do("POST", "/api/v1/admin/users", admin, map[string]any{"email": "bob@x.io", "password": "bobpass12"}, nil); c != 409 {
		t.Fatalf("duplicate user: %d", c)
	}
	bob := e.login("bob@x.io", "bobpass12")
	if c := e.do("GET", "/api/v1/admin/users", bob, nil, nil); c != 403 {
		t.Fatalf("non-admin reached admin API: %d", c)
	}

	e.do("POST", "/api/v1/admin/groups", admin, map[string]string{"name": "Family"}, &created)
	groupID := created.ID
	e.do("POST", "/api/v1/admin/folders", admin, map[string]string{"name": "Top 100"}, &created)
	shared := created.ID

	z := zipBytes(map[string]string{"a.mp3": "AAA", "Chill/b.mp3": "BBB", "notes.txt": "x"})
	if c := e.upload(fmt.Sprintf("/api/v1/admin/folders/%d/upload", shared), admin, "files", "pack.zip", z); c != 202 {
		t.Fatalf("upload zip: %d", c)
	}
	waitFor(t, "zip import", func() bool {
		var jobsList []jobs.ImportJob
		e.do("GET", "/api/v1/admin/imports", admin, nil, &jobsList)
		return len(jobsList) == 1 && jobsList[0].Status == "done" && jobsList[0].Processed == 2
	})

	// Bob sees nothing shared until access is granted (via the group).
	var pull library.PullResult
	e.do("GET", "/api/v1/sync?since=0", bob, nil, &pull)
	if len(pull.VisibleFolderIDs) != 0 {
		t.Fatalf("bob sees folders before grant: %v", pull.VisibleFolderIDs)
	}
	cursor := pull.Cursor
	e.do("PUT", fmt.Sprintf("/api/v1/admin/folders/%d/access", shared), admin, map[string]any{"group_ids": []int64{groupID}}, nil)
	e.do("PUT", fmt.Sprintf("/api/v1/admin/groups/%d/members", groupID), admin, map[string]any{"user_ids": []int64{bobID}}, nil)

	e.do("GET", fmt.Sprintf("/api/v1/sync?since=%d", cursor), bob, nil, &pull)
	if len(pull.Folders) != 2 || len(pull.Items) != 2 || len(pull.Tracks) != 2 {
		t.Fatalf("delta after grant: folders=%d items=%d tracks=%d", len(pull.Folders), len(pull.Items), len(pull.Tracks))
	}
	cursor = pull.Cursor

	// Bob can download a shared track through a signed URL.
	var u struct{ URL string }
	if c := e.do("GET", fmt.Sprintf("/api/v1/tracks/%d/url", pull.Tracks[0].ID), bob, nil, &u); c != 200 {
		t.Fatalf("track url: %d", c)
	}
	resp, err := http.Get(u.URL)
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("download signed url: %v %v", err, resp)
	}
	resp.Body.Close()

	// Shared folders are read-only for users.
	var push library.PushResult
	e.do("POST", "/api/v1/sync/push", bob, map[string]any{"ops": []library.Op{{Op: "folder.delete", ID: shared}}}, &push)
	if len(push.Errors) != 1 {
		t.Fatalf("user deleted a shared folder: %+v", push)
	}

	// --- offline edits: create folders with refs, copy a shared track, then move it ---
	name, sub := "Gym", "Cardio"
	ops := []library.Op{
		{Op: "folder.upsert", Ref: "c1", Name: &name},
		{Op: "folder.upsert", Ref: "c2", ParentRef: "c1", Name: &sub},
		{Op: "item.upsert", Ref: "i1", FolderRef: "c1", TrackID: pull.Tracks[0].ID},
	}
	e.do("POST", "/api/v1/sync/push", bob, map[string]any{"ops": ops}, &push)
	if len(push.Errors) != 0 || push.Folders["c1"] == 0 || push.Folders["c2"] == 0 || push.Items["i1"] == 0 {
		t.Fatalf("push: %+v", push)
	}
	ops = []library.Op{{Op: "item.upsert", Ref: "i2", ID: push.Items["i1"], FolderID: push.Folders["c2"]}}
	gym, cardio := push.Folders["c1"], push.Folders["c2"]
	e.do("POST", "/api/v1/sync/push", bob, map[string]any{"ops": ops}, &push)
	if len(push.Errors) != 0 {
		t.Fatalf("move: %+v", push.Errors)
	}
	cycle := []library.Op{{Op: "folder.upsert", ID: gym, ParentID: &cardio}}
	e.do("POST", "/api/v1/sync/push", bob, map[string]any{"ops": cycle}, &push)
	if len(push.Errors) != 1 {
		t.Fatal("moving a folder into its own child was allowed")
	}

	e.do("GET", fmt.Sprintf("/api/v1/sync?since=%d", cursor), bob, nil, &pull)
	var live, dead int
	for _, it := range pull.Items {
		if it.Deleted {
			dead++
		} else if it.FolderID == cardio {
			live++
		}
	}
	if live != 1 || dead != 1 {
		t.Fatalf("after move: live in Cardio=%d tombstones=%d", live, dead)
	}

	// --- YouTube: download once, dedupe the second request ---
	var job jobs.YouTubeJob
	if c := e.do("POST", "/api/v1/youtube", bob, map[string]any{"url": "https://youtu.be/dQw4w9WgXcQ?si=abc", "folder_id": gym}, &job); c != 202 {
		t.Fatalf("youtube: %d", c)
	}
	if c := e.do("POST", "/api/v1/youtube", bob, map[string]any{"url": "https://example.com/x", "folder_id": gym}, nil); c != 400 {
		t.Fatalf("non-youtube url accepted: %d", c)
	}
	if c := e.do("POST", "/api/v1/youtube", bob, map[string]any{"url": "https://youtu.be/dQw4w9WgXcQ", "folder_id": shared}, nil); c != 403 {
		t.Fatalf("youtube into shared folder: %d", c)
	}
	waitFor(t, "youtube job", func() bool {
		e.do("GET", fmt.Sprintf("/api/v1/youtube/%d", job.ID), bob, nil, &job)
		return job.Status == "done" || job.Status == "error"
	})
	if job.Status != "done" {
		t.Fatalf("youtube job failed: %s", job.Error)
	}
	e.do("POST", "/api/v1/youtube", bob, map[string]any{"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "folder_id": cardio}, &job)
	waitFor(t, "second youtube job", func() bool {
		e.do("GET", fmt.Sprintf("/api/v1/youtube/%d", job.ID), bob, nil, &job)
		return job.Status == "done" || job.Status == "error"
	})
	if ytCalls != 1 {
		t.Fatalf("expected the video to be downloaded once, got %d", ytCalls)
	}
	var title string
	conn.QueryRow(`SELECT title FROM tracks WHERE source = 'youtube'`).Scan(&title)
	if title != "My Video" {
		t.Fatalf("youtube title = %q", title)
	}

	// --- revoking access removes the shared folders from Bob's visible set ---
	e.do("PUT", fmt.Sprintf("/api/v1/admin/folders/%d/access", shared), admin, map[string]any{}, nil)
	e.do("GET", "/api/v1/sync?since=0", bob, nil, &pull)
	for _, id := range pull.VisibleFolderIDs {
		if id == shared {
			t.Fatal("shared folder still visible after revoke")
		}
	}
	if len(pull.VisibleFolderIDs) != 2 {
		t.Fatalf("bob should still see his own 2 folders, got %v", pull.VisibleFolderIDs)
	}

	// --- disabling a user blocks refresh ---
	var tok auth.Tokens
	e.do("POST", "/api/v1/auth/login", "", map[string]string{"email": "bob@x.io", "password": "bobpass12"}, &tok)
	disabled := true
	e.do("PATCH", fmt.Sprintf("/api/v1/admin/users/%d", bobID), admin, map[string]any{"disabled": disabled}, nil)
	if c := e.do("POST", "/api/v1/auth/refresh", "", map[string]string{"refresh_token": tok.RefreshToken}, nil); c != 401 {
		t.Fatalf("disabled user refreshed: %d", c)
	}
	if !strings.Contains(u.URL, "sig=") {
		t.Fatal("signed url missing signature")
	}
}
