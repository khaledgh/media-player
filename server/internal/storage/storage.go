package storage

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// Store is the object storage used for audio files and cover art.
type Store interface {
	Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error
	// URL returns a time-limited download URL for key.
	URL(ctx context.Context, key string, ttl time.Duration) (string, error)
	Delete(ctx context.Context, key string) error
}

// ---------- S3 / Cloudflare R2 (S3 API) ----------

type S3Config struct {
	Endpoint     string
	Region       string
	Bucket       string
	AccessKey    string
	SecretKey    string
	CustomDomain string
	UsePathStyle bool
}

type S3 struct {
	client       *s3.Client
	presign      *s3.PresignClient
	bucket       string
	customDomain string
}

type R2 = S3

func normalizeCustomDomain(d string) string {
	d = strings.TrimSpace(d)
	if d == "" {
		return ""
	}
	if !strings.HasPrefix(d, "http://") && !strings.HasPrefix(d, "https://") {
		d = "https://" + d
	}
	return strings.TrimRight(d, "/")
}

func NewS3(cfg S3Config) *S3 {
	region := cfg.Region
	if region == "" {
		region = "auto"
	}
	opts := s3.Options{
		Region:       region,
		Credentials:  credentials.NewStaticCredentialsProvider(cfg.AccessKey, cfg.SecretKey, ""),
		UsePathStyle: cfg.UsePathStyle,
	}
	if cfg.Endpoint != "" {
		opts.BaseEndpoint = aws.String(cfg.Endpoint)
	}
	client := s3.New(opts)
	return &S3{
		client:       client,
		presign:      s3.NewPresignClient(client),
		bucket:       cfg.Bucket,
		customDomain: normalizeCustomDomain(cfg.CustomDomain),
	}
}

func NewR2(accountID, accessKey, secret, bucket string, customDomain ...string) *S3 {
	var cdomain string
	if len(customDomain) > 0 {
		cdomain = customDomain[0]
	}
	return NewS3(S3Config{
		Endpoint:     fmt.Sprintf("https://%s.r2.cloudflarestorage.com", accountID),
		Region:       "auto",
		Bucket:       bucket,
		AccessKey:    accessKey,
		SecretKey:    secret,
		CustomDomain: cdomain,
		UsePathStyle: true,
	})
}

func (s *S3) Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error {
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(s.bucket),
		Key:           aws.String(key),
		Body:          r,
		ContentLength: aws.Int64(size),
		ContentType:   aws.String(contentType),
	})
	return err
}

func (s *S3) URL(ctx context.Context, key string, ttl time.Duration) (string, error) {
	if s.customDomain != "" {
		escaped := (&url.URL{Path: "/" + strings.TrimPrefix(key, "/")}).EscapedPath()
		return s.customDomain + escaped, nil
	}
	req, err := s.presign.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	}, s3.WithPresignExpires(ttl))
	if err != nil {
		return "", err
	}
	return req.URL, nil
}

func (s *S3) Delete(ctx context.Context, key string) error {
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(key)})
	return err
}

// ---------- Local disk (development / tests) ----------

// Local stores objects on disk and serves them through Handler with
// HMAC-signed, expiring URLs so it behaves like presigned R2 URLs.
type Local struct {
	dir     string
	baseURL string // e.g. http://host:8080/files
	secret  []byte
}

func NewLocal(dir, publicURL string, secret []byte) (*Local, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	return &Local{dir: dir, baseURL: strings.TrimRight(publicURL, "/") + "/files", secret: secret}, nil
}

func (s *Local) path(key string) (string, error) {
	clean := filepath.Clean(filepath.FromSlash(key))
	if strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) {
		return "", errors.New("invalid key")
	}
	return filepath.Join(s.dir, clean), nil
}

func (s *Local) Put(_ context.Context, key string, r io.Reader, _ int64, _ string) error {
	p, err := s.path(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	tmp := p + ".part"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, r); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

func (s *Local) sign(key string, exp int64) string {
	m := hmac.New(sha256.New, s.secret)
	fmt.Fprintf(m, "%s|%d", key, exp)
	return hex.EncodeToString(m.Sum(nil))
}

func (s *Local) URL(_ context.Context, key string, ttl time.Duration) (string, error) {
	exp := time.Now().Add(ttl).Unix()
	return fmt.Sprintf("%s/%s?exp=%d&sig=%s", s.baseURL, url.PathEscape(key), exp, s.sign(key, exp)), nil
}

func (s *Local) Delete(_ context.Context, key string) error {
	p, err := s.path(key)
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// Handler serves signed object URLs. Mount it at /files/.
func (s *Local) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key, err := url.PathUnescape(strings.TrimPrefix(r.URL.EscapedPath(), "/files/"))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		exp, _ := strconv.ParseInt(r.URL.Query().Get("exp"), 10, 64)
		if exp < time.Now().Unix() || !hmac.Equal([]byte(r.URL.Query().Get("sig")), []byte(s.sign(key, exp))) {
			http.Error(w, "link expired or invalid", http.StatusForbidden)
			return
		}
		p, err := s.path(key)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, p)
	})
}
