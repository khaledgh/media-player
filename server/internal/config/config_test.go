package config

import (
	"os"
	"testing"
)

func TestConfigS3CustomDomain(t *testing.T) {
	os.Setenv("JWT_SECRET", "test-secret")
	os.Setenv("S3_BUCKET", "my-bucket")
	os.Setenv("S3_ACCESS_KEY", "access-123")
	os.Setenv("S3_SECRET", "secret-456")
	os.Setenv("S3_ENDPOINT", "https://s3.example.com")
	os.Setenv("S3_CUSTOM_DOMAIN", "media.example.com")
	defer func() {
		os.Unsetenv("JWT_SECRET")
		os.Unsetenv("S3_BUCKET")
		os.Unsetenv("S3_ACCESS_KEY")
		os.Unsetenv("S3_SECRET")
		os.Unsetenv("S3_ENDPOINT")
		os.Unsetenv("S3_CUSTOM_DOMAIN")
	}()

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.StorageDriver != "s3" {
		t.Errorf("expected StorageDriver = s3, got %s", cfg.StorageDriver)
	}
	if cfg.S3CustomDomain != "media.example.com" {
		t.Errorf("expected S3CustomDomain = media.example.com, got %s", cfg.S3CustomDomain)
	}
	if cfg.S3Bucket != "my-bucket" {
		t.Errorf("expected S3Bucket = my-bucket, got %s", cfg.S3Bucket)
	}
}
