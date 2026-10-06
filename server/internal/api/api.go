package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"mume/server/internal/auth"
	"mume/server/internal/jobs"
	"mume/server/internal/library"
	"mume/server/internal/storage"
)

type Server struct {
	DB        *sql.DB
	Auth      *auth.Service
	Lib       *library.Library
	Jobs      *jobs.Runner
	Store     storage.Store
	MaxUpload int64
	Web       fs.FS        // built CMS (may be nil)
	Files     http.Handler // local storage file server (nil when using R2)
}

const urlTTL = 6 * time.Hour

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Recoverer, middleware.Logger)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"Authorization", "Content-Type"},
		MaxAge:         600,
	}))

	r.Get("/health", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, 200, map[string]string{"status": "ok"}) })
	if s.Files != nil {
		r.Handle("/files/*", s.Files)
	}

	r.Route("/api/v1", func(r chi.Router) {
		r.Post("/auth/login", s.login)
		r.Post("/auth/refresh", s.refresh)
		r.Post("/auth/logout", s.logout)

		r.Group(func(r chi.Router) {
			r.Use(s.Auth.Middleware)
			r.Get("/me", s.me)
			r.Get("/sync", s.syncPull)
			r.Post("/sync/push", s.syncPush)
			r.Get("/tracks/{id}/url", s.trackURL)
			r.Post("/tracks/upload", s.uploadTrack)
			r.Post("/youtube", s.createYouTube)
			r.Get("/youtube/{id}", s.getYouTube)

			r.Route("/admin", func(r chi.Router) {
				r.Use(auth.RequireAdmin)
				s.adminRoutes(r)
			})
		})
	})

	if s.Web != nil {
		r.NotFound(s.spa)
	}
	return r
}

// spa serves the embedded CMS, falling back to index.html for client routes.
func (s *Server) spa(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	p := strings.TrimPrefix(r.URL.Path, "/")
	if p == "" {
		p = "index.html"
	}
	if _, err := fs.Stat(s.Web, p); err != nil {
		p = "index.html"
	} else if strings.HasPrefix(p, "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
	http.ServeFileFS(w, r, s.Web, p)
}

// ---------- helpers ----------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// fail maps domain errors to HTTP statuses.
func fail(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, library.ErrNotFound), errors.Is(err, sql.ErrNoRows):
		writeErr(w, http.StatusNotFound, "not found")
	case errors.Is(err, library.ErrForbidden):
		writeErr(w, http.StatusForbidden, "forbidden")
	case errors.Is(err, library.ErrInvalid):
		writeErr(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, auth.ErrInvalidCredentials):
		writeErr(w, http.StatusUnauthorized, err.Error())
	default:
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			writeErr(w, http.StatusRequestEntityTooLarge, "upload too large")
			return
		}
		if isDuplicate(err) {
			writeErr(w, http.StatusConflict, "already exists")
			return
		}
		log.Printf("internal error: %v", err)
		writeErr(w, http.StatusInternalServerError, "internal error")
	}
}

func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 4<<20)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON body")
		return false
	}
	return true
}

func idParam(r *http.Request, name string) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, name), 10, 64)
	return id, err == nil && id > 0
}

func badID(w http.ResponseWriter) { writeErr(w, http.StatusBadRequest, "invalid id") }
