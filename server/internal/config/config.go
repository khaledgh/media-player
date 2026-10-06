package config

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Addr      string
	DBDSN     string
	JWTSecret string
	PublicURL string // used to build signed URLs for the local storage driver

	// Storage: "s3", "r2", or "local"
	StorageDriver  string
	DataDir        string
	S3Endpoint     string
	S3Region       string
	S3Bucket       string
	S3AccessKey    string
	S3Secret       string
	S3CustomDomain string
	S3UsePathStyle bool

	// Aliases for backwards compatibility with R2_*
	R2AccountID    string
	R2AccessKey    string
	R2Secret       string
	R2Bucket       string
	R2CustomDomain string

	NodeYTURL string
	NodeYTKey string

	AdminEmail    string
	AdminPassword string

	AccessTTL  time.Duration
	RefreshTTL time.Duration
	MaxUpload  int64 // bytes
	Workers    int
}

func Load() (*Config, error) {
	loadDotEnv(".env", "server/.env", "../.env", "../../.env")

	r2AccountID := envFirst("R2_ACCOUNT_ID", "S3_ACCOUNT_ID")
	bucket := envFirst("S3_BUCKET", "R2_BUCKET")
	accessKey := envFirst("S3_ACCESS_KEY", "R2_ACCESS_KEY", "S3_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID")
	secret := envFirst("S3_SECRET", "R2_SECRET", "S3_SECRET_KEY", "S3_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY")
	customDomain := envFirst("S3_CUSTOM_DOMAIN", "R2_CUSTOM_DOMAIN", "CUSTOM_DOMAIN")
	endpoint := envFirst("S3_ENDPOINT", "R2_ENDPOINT", "AWS_ENDPOINT_URL")
	region := envFirst("S3_REGION", "R2_REGION", "AWS_REGION")

	if endpoint == "" && r2AccountID != "" {
		endpoint = fmt.Sprintf("https://%s.r2.cloudflarestorage.com", r2AccountID)
	}
	if region == "" {
		region = "auto"
	}

	storageDriver := env("STORAGE_DRIVER", "")
	if storageDriver == "" {
		if bucket != "" {
			storageDriver = "s3"
		} else {
			storageDriver = "local"
		}
	}

	// PORT sets the listening port; ADDR (host:port) overrides it when both are set.
	port := env("PORT", "8080")
	c := &Config{
		Addr:           env("ADDR", ":"+port),
		DBDSN:          env("DB_DSN", "root@tcp(127.0.0.1:3306)/mume_dev?parseTime=true&multiStatements=true&charset=utf8mb4"),
		JWTSecret:      os.Getenv("JWT_SECRET"),
		PublicURL:      env("PUBLIC_URL", "http://localhost:"+port),
		StorageDriver:  storageDriver,
		DataDir:        env("DATA_DIR", "./data"),
		S3Endpoint:     endpoint,
		S3Region:       region,
		S3Bucket:       bucket,
		S3AccessKey:    accessKey,
		S3Secret:       secret,
		S3CustomDomain: customDomain,
		S3UsePathStyle: envBool("S3_USE_PATH_STYLE", true),

		R2AccountID:    r2AccountID,
		R2AccessKey:    accessKey,
		R2Secret:       secret,
		R2Bucket:       bucket,
		R2CustomDomain: customDomain,

		NodeYTURL:     env("NODE_YT_URL", "http://localhost:3000"),
		NodeYTKey:     os.Getenv("NODE_YT_KEY"),
		AdminEmail:    os.Getenv("ADMIN_BOOTSTRAP_EMAIL"),
		AdminPassword: os.Getenv("ADMIN_BOOTSTRAP_PASSWORD"),
		AccessTTL:     time.Hour,
		RefreshTTL:    60 * 24 * time.Hour,
		MaxUpload:     int64(envInt("MAX_UPLOAD_MB", 2048)) << 20,
		Workers:       envInt("YT_WORKERS", 2),
	}
	if c.JWTSecret == "" {
		return nil, fmt.Errorf("JWT_SECRET is required")
	}
	if c.StorageDriver == "r2" || c.StorageDriver == "s3" {
		if c.S3Bucket == "" || c.S3AccessKey == "" || c.S3Secret == "" {
			return nil, fmt.Errorf("bucket, access key, and secret are required for %s storage driver (set S3_* or R2_*)", c.StorageDriver)
		}
		if c.S3Endpoint == "" {
			return nil, fmt.Errorf("endpoint or R2_ACCOUNT_ID is required for %s storage driver (set S3_ENDPOINT or R2_ACCOUNT_ID)", c.StorageDriver)
		}
	}
	return c, nil
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func envFirst(keys ...string) string {
	for _, k := range keys {
		if v := os.Getenv(k); v != "" {
			return v
		}
	}
	return ""
}

func envBool(k string, def bool) bool {
	if v := os.Getenv(k); v != "" {
		b, err := strconv.ParseBool(v)
		if err == nil {
			return b
		}
	}
	return def
}

func envInt(k string, def int) int {
	if v, err := strconv.Atoi(os.Getenv(k)); err == nil && v > 0 {
		return v
	}
	return def
}

// loadDotEnv attempts to read key=value pairs from the first existing .env file in paths.
// Existing environment variables already set in the OS/shell are not overwritten.
func loadDotEnv(paths ...string) {
	for _, p := range paths {
		f, err := os.Open(p)
		if err != nil {
			continue
		}
		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			parts := strings.SplitN(line, "=", 2)
			if len(parts) != 2 {
				continue
			}
			key := strings.TrimSpace(parts[0])
			val := strings.TrimSpace(parts[1])
			if len(val) >= 2 && ((val[0] == '"' && val[len(val)-1] == '"') || (val[0] == '\'' && val[len(val)-1] == '\'')) {
				val = val[1 : len(val)-1]
			}
			if _, exists := os.LookupEnv(key); !exists {
				_ = os.Setenv(key, val)
			}
		}
		f.Close()
		return
	}
}
