package storage

import (
	"context"
	"testing"
	"time"
)

func TestNormalizeCustomDomain(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"", ""},
		{"   ", ""},
		{"media.example.com", "https://media.example.com"},
		{"media.example.com/", "https://media.example.com"},
		{"https://media.example.com", "https://media.example.com"},
		{"https://media.example.com/", "https://media.example.com"},
		{"https://cdn.example.com# e.g. https://media.example.com (or pub-xxx.r2.dev)", "https://cdn.example.com"},
		{"https://cdn.example.com # note", "https://cdn.example.com"},
		{"http://localhost:9000", "http://localhost:9000"},
		{"http://localhost:9000/", "http://localhost:9000"},
		{"https://cdn.example.com/assets/", "https://cdn.example.com/assets"},
	}

	for _, c := range cases {
		got := normalizeCustomDomain(c.in)
		if got != c.want {
			t.Errorf("normalizeCustomDomain(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestS3CustomDomainURL(t *testing.T) {
	s := &S3{
		bucket:       "my-bucket",
		customDomain: "https://media.example.com",
	}

	got, err := s.URL(context.Background(), "tracks/12/song.mp3", time.Hour)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := "https://media.example.com/tracks/12/song.mp3"
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}

	// Test key with special characters / spaces
	got, err = s.URL(context.Background(), "tracks/12/my song (remix).mp3", time.Hour)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want = "https://media.example.com/tracks/12/my%20song%20%28remix%29.mp3"
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}
