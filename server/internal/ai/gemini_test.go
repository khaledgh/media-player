package ai

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSuggest(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-goog-api-key") != "k" {
			t.Error("missing api key")
		}
		w.Write([]byte(`{"candidates":[{"content":{"parts":[{"text":"[{\"id\":1,\"title\":\"يا طير\",\"artist\":\"فيروز\",\"confidence\":\"high\"},{\"id\":99,\"title\":\"x\",\"artist\":\"y\",\"confidence\":\"high\"}]"}]}}]}`))
	}))
	defer srv.Close()
	c := &Client{Key: "k", BaseURL: srv.URL}
	got, err := c.Suggest(context.Background(), []Item{{ID: 1, Title: "ya tair"}, {ID: 2, Title: "other", Artist: "a"}}, "ar")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Artist != "فيروز" || got[0].Confidence != "high" {
		t.Fatalf("unexpected %+v", got)
	}
	// id 2 was not answered: original kept, low confidence; id 99 dropped.
	if got[1].Title != "other" || got[1].Artist != "a" || got[1].Confidence != "low" {
		t.Fatalf("fallback wrong: %+v", got[1])
	}
}

func TestSuggestDisabled(t *testing.T) {
	if _, err := (&Client{}).Suggest(context.Background(), nil, "ar"); err != ErrDisabled {
		t.Fatalf("got %v", err)
	}
	if _, err := (&Client{Key: "k"}).Suggest(context.Background(), nil, "fr"); err == nil {
		t.Fatal("expected unsupported language error")
	}
}
