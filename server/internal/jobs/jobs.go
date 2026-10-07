// Package jobs runs background work: YouTube downloads (via the node-yt
// worker) and CMS uploads (single files or zip archives).
package jobs

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"mume/server/internal/ai"
	"mume/server/internal/db"
	"mume/server/internal/library"
	"mume/server/internal/zipimport"
)

type Runner struct {
	DB        *sql.DB
	Lib       *library.Library
	NodeYTURL string
	NodeYTKey string
	Workers   int
	HTTP      *http.Client
	AI        *ai.Client // optional; nil/unconfigured skips name cleanup

	yt      chan int64
	imports chan int64
}

func (r *Runner) Start(ctx context.Context) {
	if r.HTTP == nil {
		r.HTTP = &http.Client{Timeout: 20 * time.Minute}
	}
	if r.Workers < 1 {
		r.Workers = 1
	}
	r.yt = make(chan int64, 256)
	r.imports = make(chan int64, 256)
	// Jobs interrupted by a restart go back to the queue.
	r.DB.ExecContext(ctx, `UPDATE youtube_jobs SET status = 'queued' WHERE status = 'running'`)
	r.DB.ExecContext(ctx, `UPDATE import_jobs SET status = 'error', error = 'interrupted by server restart' WHERE status = 'running'`)

	for i := 0; i < r.Workers; i++ {
		go r.loop(ctx, r.yt, r.processYouTube)
	}
	go r.loop(ctx, r.imports, r.processImport)
	go r.sweep(ctx)
}

func (r *Runner) loop(ctx context.Context, ch chan int64, fn func(context.Context, int64)) {
	for {
		select {
		case <-ctx.Done():
			return
		case id := <-ch:
			fn(ctx, id)
		}
	}
}

// sweep re-enqueues queued YouTube jobs periodically, covering jobs created
// while the channel was full and jobs left over from a restart.
func (r *Runner) sweep(ctx context.Context) {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for {
		rows, err := r.DB.QueryContext(ctx, `SELECT id FROM youtube_jobs WHERE status = 'queued' ORDER BY id LIMIT 100`)
		if err == nil {
			for rows.Next() {
				var id int64
				if rows.Scan(&id) == nil {
					r.notify(r.yt, id)
				}
			}
			rows.Close()
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func (r *Runner) notify(ch chan int64, id int64) {
	select {
	case ch <- id:
	default: // the sweep picks it up later
	}
}

// ---------- YouTube ----------

var ytID = regexp.MustCompile(`(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|embed/|live/)|youtu\.be/|music\.youtube\.com/watch\?(?:.*&)?v=)([A-Za-z0-9_-]{11})`)

// CanonicalYouTubeURL returns https://www.youtube.com/watch?v=<id>, or an error
// if raw is not a YouTube video link.
func CanonicalYouTubeURL(raw string) (string, error) {
	m := ytID.FindStringSubmatch(strings.TrimSpace(raw))
	if m == nil {
		return "", fmt.Errorf("%w: not a YouTube video link", library.ErrInvalid)
	}
	return "https://www.youtube.com/watch?v=" + m[1], nil
}

type YouTubeJob struct {
	ID        int64  `json:"id"`
	UserID    int64  `json:"user_id"`
	UserEmail string `json:"user_email,omitempty"`
	URL       string `json:"url"`
	FolderID  int64  `json:"folder_id"`
	Status    string `json:"status"`
	Error     string `json:"error,omitempty"`
	TrackID   *int64 `json:"track_id"`
	CreatedAt int64  `json:"created_at"`
}

// aiLang is "ar", "en" or "" (no AI cleanup for this job).
func (r *Runner) EnqueueYouTube(ctx context.Context, userID, folderID int64, rawURL, aiLang string) (int64, error) {
	u, err := CanonicalYouTubeURL(rawURL)
	if err != nil {
		return 0, err
	}
	var lang any
	if _, ok := ai.LangName(aiLang); ok {
		lang = aiLang
	}
	res, err := r.DB.ExecContext(ctx, `INSERT INTO youtube_jobs (user_id, url, folder_id, ai_lang) VALUES (?, ?, ?, ?)`, userID, u, folderID, lang)
	if err != nil {
		return 0, err
	}
	id, _ := res.LastInsertId()
	r.notify(r.yt, id)
	return id, nil
}

func (r *Runner) GetYouTubeJob(ctx context.Context, id int64) (YouTubeJob, error) {
	var j YouTubeJob
	var errText sql.NullString
	var track sql.NullInt64
	var created time.Time
	err := r.DB.QueryRowContext(ctx, `SELECT id, user_id, url, folder_id, status, error, track_id, created_at FROM youtube_jobs WHERE id = ?`, id).
		Scan(&j.ID, &j.UserID, &j.URL, &j.FolderID, &j.Status, &errText, &track, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return j, library.ErrNotFound
	}
	j.Error, j.CreatedAt = errText.String, created.UnixMilli()
	if track.Valid {
		j.TrackID = &track.Int64
	}
	return j, err
}

func (r *Runner) ListYouTubeJobs(ctx context.Context, limit int) ([]YouTubeJob, error) {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT j.id, j.user_id, u.email, j.url, j.folder_id, j.status, j.error, j.track_id, j.created_at
		FROM youtube_jobs j JOIN users u ON u.id = j.user_id ORDER BY j.id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []YouTubeJob{}
	for rows.Next() {
		var j YouTubeJob
		var errText sql.NullString
		var track sql.NullInt64
		var created time.Time
		if err := rows.Scan(&j.ID, &j.UserID, &j.UserEmail, &j.URL, &j.FolderID, &j.Status, &errText, &track, &created); err != nil {
			return nil, err
		}
		j.Error, j.CreatedAt = errText.String, created.UnixMilli()
		if track.Valid {
			j.TrackID = &track.Int64
		}
		out = append(out, j)
	}
	return out, rows.Err()
}

func (r *Runner) claim(ctx context.Context, table string, id int64) bool {
	res, err := r.DB.ExecContext(ctx, `UPDATE `+table+` SET status = 'running' WHERE id = ? AND status = 'queued'`, id)
	if err != nil {
		return false
	}
	n, _ := res.RowsAffected()
	return n == 1
}

func (r *Runner) processYouTube(ctx context.Context, id int64) {
	if !r.claim(ctx, "youtube_jobs", id) {
		return
	}
	trackID, err := r.downloadYouTube(ctx, id)
	if err != nil {
		log.Printf("youtube job %d: %v", id, err)
		r.DB.ExecContext(ctx, `UPDATE youtube_jobs SET status = 'error', error = ? WHERE id = ?`, truncate(err.Error(), 2000), id)
		return
	}
	r.DB.ExecContext(ctx, `UPDATE youtube_jobs SET status = 'done', error = NULL, track_id = ? WHERE id = ?`, trackID, id)
}

func (r *Runner) downloadYouTube(ctx context.Context, jobID int64) (int64, error) {
	j, err := r.GetYouTubeJob(ctx, jobID)
	if err != nil {
		return 0, err
	}
	trackID, found, err := r.Lib.FindBySourceURL(ctx, j.URL)
	if err != nil {
		return 0, err
	}
	if !found {
		trackID, err = r.fetchFromNodeYT(ctx, j.URL)
		if err != nil {
			return 0, err
		}
		// Only fresh downloads are cleaned up, so earlier manual edits are never overwritten.
		if folder := r.cleanNames(ctx, j, trackID); folder != 0 {
			j.FolderID = folder
		}
	}
	err = db.WithTx(ctx, r.DB, func(tx *sql.Tx) error {
		_, err := r.Lib.AttachTrack(ctx, tx, j.FolderID, trackID)
		return err
	})
	return trackID, err
}

// cleanNames asks Gemini for a proper title and artist, stores them, and
// returns the user's folder for that artist (created if needed), or 0 when
// the AI step was skipped or failed. It never fails the download.
func (r *Runner) cleanNames(ctx context.Context, j YouTubeJob, trackID int64) int64 {
	if !r.AI.Enabled() {
		return 0
	}
	var lang sql.NullString
	if err := r.DB.QueryRowContext(ctx, `SELECT ai_lang FROM youtube_jobs WHERE id = ?`, j.ID).Scan(&lang); err != nil || !lang.Valid {
		return 0
	}
	metas, err := r.Lib.TrackMetas(ctx, []int64{trackID})
	if err != nil || len(metas) != 1 {
		return 0
	}
	sug, err := r.AI.Suggest(ctx, []ai.Item{{ID: trackID, Title: metas[0].Title, Artist: metas[0].Artist}}, lang.String)
	if err != nil || len(sug) != 1 {
		log.Printf("youtube job %d: ai cleanup skipped: %v", j.ID, err)
		return 0
	}
	s := sug[0]
	if s.Confidence != "high" {
		return 0
	}
	if err := r.Lib.SetTrackMeta(ctx, r.DB, trackID, s.Title, s.Artist); err != nil {
		log.Printf("youtube job %d: save ai names: %v", j.ID, err)
		return 0
	}
	if s.Artist == "" {
		return 0
	}
	folder, err := r.Lib.EnsureUserRootFolder(ctx, j.UserID, s.Artist)
	if err != nil {
		log.Printf("youtube job %d: artist folder: %v", j.ID, err)
		return 0
	}
	return folder
}

func (r *Runner) fetchFromNodeYT(ctx context.Context, videoURL string) (int64, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		strings.TrimRight(r.NodeYTURL, "/")+"/download?url="+url.QueryEscape(videoURL), nil)
	if err != nil {
		return 0, err
	}
	if r.NodeYTKey != "" {
		req.Header.Set("X-Internal-Key", r.NodeYTKey)
	}
	resp, err := r.HTTP.Do(req)
	if err != nil {
		return 0, fmt.Errorf("youtube service unreachable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2000))
		return 0, fmt.Errorf("youtube service returned %d: %s", resp.StatusCode, body)
	}
	tmp, err := os.CreateTemp("", "mume-yt-*.mp3")
	if err != nil {
		return 0, err
	}
	defer os.Remove(tmp.Name())
	_, err = io.Copy(tmp, resp.Body)
	tmp.Close()
	if err != nil {
		return 0, fmt.Errorf("download interrupted: %w", err)
	}
	title, _ := url.QueryUnescape(resp.Header.Get("X-Video-Title"))
	secs, _ := strconv.ParseFloat(resp.Header.Get("X-Video-Duration"), 64)
	return r.Lib.Ingest(ctx, library.IngestInput{
		Path:          tmp.Name(),
		FileName:      "youtube.mp3",
		Source:        "youtube",
		SourceURL:     videoURL,
		FallbackTitle: title,
		DurationMs:    int(secs * 1000),
	})
}

// ---------- CMS imports ----------

type ImportJob struct {
	ID        int64  `json:"id"`
	FolderID  int64  `json:"folder_id"`
	FileName  string `json:"file_name"`
	Status    string `json:"status"`
	Total     int    `json:"total"`
	Processed int    `json:"processed"`
	Failed    int    `json:"failed"`
	Error     string `json:"error,omitempty"`
	CreatedAt int64  `json:"created_at"`
}

// ImportDir holds uploaded files until their job has processed them.
func (r *Runner) importPath(id int64, fileName string) string {
	return filepath.Join(os.TempDir(), fmt.Sprintf("mume-import-%d%s", id, strings.ToLower(filepath.Ext(fileName))))
}

// EnqueueImport takes ownership of the uploaded file at src (it is moved).
func (r *Runner) EnqueueImport(ctx context.Context, folderID int64, fileName string, src io.Reader) (int64, error) {
	res, err := r.DB.ExecContext(ctx, `INSERT INTO import_jobs (folder_id, file_name) VALUES (?, ?)`, folderID, truncate(fileName, 512))
	if err != nil {
		return 0, err
	}
	id, _ := res.LastInsertId()
	f, err := os.Create(r.importPath(id, fileName))
	if err == nil {
		_, err = io.Copy(f, src)
		f.Close()
	}
	if err != nil {
		r.DB.ExecContext(ctx, `UPDATE import_jobs SET status = 'error', error = ? WHERE id = ?`, err.Error(), id)
		return id, err
	}
	r.notify(r.imports, id)
	return id, nil
}

const importCols = `id, folder_id, file_name, status, total, processed, failed, error, created_at`

func scanImport(sc interface{ Scan(...any) error }) (ImportJob, error) {
	var j ImportJob
	var e sql.NullString
	var created time.Time
	err := sc.Scan(&j.ID, &j.FolderID, &j.FileName, &j.Status, &j.Total, &j.Processed, &j.Failed, &e, &created)
	j.Error, j.CreatedAt = e.String, created.UnixMilli()
	return j, err
}

func (r *Runner) GetImport(ctx context.Context, id int64) (ImportJob, error) {
	j, err := scanImport(r.DB.QueryRowContext(ctx, `SELECT `+importCols+` FROM import_jobs WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return j, library.ErrNotFound
	}
	return j, err
}

func (r *Runner) ListImports(ctx context.Context, limit int) ([]ImportJob, error) {
	rows, err := r.DB.QueryContext(ctx, `SELECT `+importCols+` FROM import_jobs ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ImportJob{}
	for rows.Next() {
		j, err := scanImport(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, j)
	}
	return out, rows.Err()
}

type libSink struct {
	ctx context.Context
	r   *Runner
}

func (s libSink) EnsureFolder(ctx context.Context, parent int64, name string) (int64, error) {
	return s.r.Lib.EnsureChildFolder(ctx, parent, name)
}

func (s libSink) ImportFile(ctx context.Context, folderID int64, p, name string) error {
	trackID, err := s.r.Lib.Ingest(ctx, library.IngestInput{Path: p, FileName: name, Source: "upload"})
	if err != nil {
		return err
	}
	return db.WithTx(ctx, s.r.DB, func(tx *sql.Tx) error {
		_, err := s.r.Lib.AttachTrack(ctx, tx, folderID, trackID)
		return err
	})
}

func (r *Runner) processImport(ctx context.Context, id int64) {
	if !r.claim(ctx, "import_jobs", id) {
		return
	}
	j, err := r.GetImport(ctx, id)
	if err != nil {
		return
	}
	p := r.importPath(id, j.FileName)
	defer os.Remove(p)
	sink := libSink{ctx: ctx, r: r}

	var failures []error
	if strings.EqualFold(filepath.Ext(j.FileName), ".zip") {
		failures, err = zipimport.Run(ctx, p, j.FolderID, sink, library.IsAudio, func(total, processed, failed int) {
			r.DB.ExecContext(ctx, `UPDATE import_jobs SET total = ?, processed = ?, failed = ? WHERE id = ?`, total, processed, failed, id)
		})
	} else {
		r.DB.ExecContext(ctx, `UPDATE import_jobs SET total = 1 WHERE id = ?`, id)
		if e := sink.ImportFile(ctx, j.FolderID, p, j.FileName); e != nil {
			failures = []error{e}
		}
		r.DB.ExecContext(ctx, `UPDATE import_jobs SET processed = 1, failed = ? WHERE id = ?`, len(failures), id)
	}
	if err != nil {
		r.DB.ExecContext(ctx, `UPDATE import_jobs SET status = 'error', error = ? WHERE id = ?`, truncate(err.Error(), 4000), id)
		return
	}
	// Partial failures still finish as done; the per-file errors are kept for the CMS.
	var detail sql.NullString
	if len(failures) > 0 {
		msgs := make([]string, 0, len(failures))
		for _, f := range failures {
			msgs = append(msgs, f.Error())
		}
		detail = sql.NullString{String: truncate(strings.Join(msgs, "\n"), 4000), Valid: true}
	}
	if len(failures) > 0 && j.Total <= 1 && !strings.EqualFold(filepath.Ext(j.FileName), ".zip") {
		r.DB.ExecContext(ctx, `UPDATE import_jobs SET status = 'error', error = ? WHERE id = ?`, detail, id)
		return
	}
	r.DB.ExecContext(ctx, `UPDATE import_jobs SET status = 'done', error = ? WHERE id = ?`, detail, id)
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}
