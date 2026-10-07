package main

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"mume/server/internal/ai"
	"mume/server/internal/api"
	"mume/server/internal/auth"
	"mume/server/internal/config"
	"mume/server/internal/db"
	"mume/server/internal/jobs"
	"mume/server/internal/library"
	"mume/server/internal/storage"
	"mume/server/web"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	conn, err := db.Open(cfg.DBDSN)
	if err != nil {
		log.Fatal(err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := db.Migrate(ctx, conn); err != nil {
		log.Fatal(err)
	}
	if err := bootstrapAdmin(ctx, conn, cfg.AdminEmail, cfg.AdminPassword); err != nil {
		log.Fatal(err)
	}

	var store storage.Store
	var files http.Handler
	if cfg.StorageDriver == "r2" || cfg.StorageDriver == "s3" {
		store = storage.NewS3(storage.S3Config{
			Endpoint:     cfg.S3Endpoint,
			Region:       cfg.S3Region,
			Bucket:       cfg.S3Bucket,
			AccessKey:    cfg.S3AccessKey,
			SecretKey:    cfg.S3Secret,
			CustomDomain: cfg.S3CustomDomain,
			UsePathStyle: cfg.S3UsePathStyle,
		})
		if cfg.S3CustomDomain != "" {
			log.Printf("storage: %s bucket %q with custom domain %s", strings.ToUpper(cfg.StorageDriver), cfg.S3Bucket, cfg.S3CustomDomain)
		} else {
			log.Printf("storage: %s bucket %q (presigned URLs)", strings.ToUpper(cfg.StorageDriver), cfg.S3Bucket)
		}
	} else {
		local, err := storage.NewLocal(filepath.Join(cfg.DataDir, "objects"), cfg.PublicURL, []byte(cfg.JWTSecret))
		if err != nil {
			log.Fatal(err)
		}
		store, files = local, local.Handler()
		log.Printf("storage: local disk at %s (set S3_* / R2_* to use S3/Cloudflare R2)", cfg.DataDir)
	}

	lib := &library.Library{DB: conn, Store: store}
	aiClient := &ai.Client{Key: cfg.GeminiKey, Model: cfg.GeminiModel}
	if !aiClient.Enabled() {
		log.Printf("AI name cleanup disabled (set GEMINI_API_KEY to enable)")
	}
	runner := &jobs.Runner{DB: conn, Lib: lib, NodeYTURL: cfg.NodeYTURL, NodeYTKey: cfg.NodeYTKey, Workers: cfg.Workers, AI: aiClient}
	runner.Start(ctx)

	webFS := web.FS()
	if webFS == nil {
		log.Printf("CMS not built: run `npm run build` in server/web")
	}
	srv := &api.Server{
		DB:        conn,
		Auth:      &auth.Service{DB: conn, Secret: []byte(cfg.JWTSecret), AccessTTL: cfg.AccessTTL, RefreshTTL: cfg.RefreshTTL},
		Lib:       lib,
		Jobs:      runner,
		Store:     store,
		AI:        aiClient,
		MaxUpload: cfg.MaxUpload,
		Web:       webFS,
		Files:     files,
	}
	httpSrv := &http.Server{Addr: cfg.Addr, Handler: srv.Router(), ReadHeaderTimeout: 15 * time.Second}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		httpSrv.Shutdown(shutdown)
	}()
	log.Printf("listening on %s", cfg.Addr)
	if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

// bootstrapAdmin creates the first admin account if it does not exist yet.
func bootstrapAdmin(ctx context.Context, conn *sql.DB, email, password string) error {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" || password == "" {
		return nil
	}
	var n int
	if err := conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE email = ?`, email).Scan(&n); err != nil || n > 0 {
		return err
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return err
	}
	_, err = conn.ExecContext(ctx, `INSERT INTO users (email, name, password_hash, role) VALUES (?, 'Admin', ?, 'admin')`, email, hash)
	if err == nil {
		log.Printf("created admin account %s", email)
	}
	return err
}
