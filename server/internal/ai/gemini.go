// Package ai asks Gemini to clean up song titles and artist names.
package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

var ErrDisabled = errors.New("AI is not configured (set GEMINI_API_KEY)")

type Client struct {
	Key     string
	Model   string
	BaseURL string // overridden in tests
	HTTP    *http.Client
}

type Item struct {
	ID     int64  `json:"id"`
	Title  string `json:"title"`
	Artist string `json:"artist"`
}

type Suggestion struct {
	ID         int64  `json:"id"`
	Title      string `json:"title"`
	Artist     string `json:"artist"`
	Confidence string `json:"confidence"` // high | low
}

func (c *Client) Enabled() bool { return c != nil && c.Key != "" }

// LangName maps a language code the API accepts to its English name.
func LangName(lang string) (string, bool) {
	switch lang {
	case "ar":
		return "Arabic", true
	case "en":
		return "English", true
	}
	return "", false
}

const batchSize = 20

// Suggest returns a cleaned title and artist for every item, in the chosen
// language ("ar" or "en"). It never invents data: unsure items come back
// unchanged with confidence "low".
func (c *Client) Suggest(ctx context.Context, items []Item, lang string) ([]Suggestion, error) {
	if !c.Enabled() {
		return nil, ErrDisabled
	}
	langName, ok := LangName(lang)
	if !ok {
		return nil, fmt.Errorf("unsupported language %q", lang)
	}
	out := make([]Suggestion, 0, len(items))
	for start := 0; start < len(items); start += batchSize {
		end := min(start+batchSize, len(items))
		part, err := c.suggestBatch(ctx, items[start:end], langName)
		if err != nil {
			return nil, err
		}
		out = append(out, part...)
	}
	return out, nil
}

func (c *Client) suggestBatch(ctx context.Context, items []Item, langName string) ([]Suggestion, error) {
	in, _ := json.Marshal(items)
	prompt := "You clean up the metadata of songs in a music library.\n" +
		"For each input item return the song's proper title and its singer/artist, written in " + langName + ".\n" +
		"Rules:\n" +
		"- Transliterate or translate names into " + langName + " the way they are normally written (well-known singers use their usual " + langName + " spelling).\n" +
		"- Remove noise such as Official Video, Lyrics, HD, (Audio), quality tags, channel names, emojis and file extensions.\n" +
		"- If the title contains the artist (e.g. Artist - Song), split them.\n" +
		"- Do not invent an artist. If you are not sure who the artist is, return an empty artist and confidence \"low\".\n" +
		"- If you are not sure about the title, keep the original title and use confidence \"low\".\n" +
		"- Return one result per input item with the same id.\n\nInput:\n" + string(in)

	body := map[string]any{
		"contents": []any{map[string]any{"parts": []any{map[string]string{"text": prompt}}}},
		"generationConfig": map[string]any{
			"temperature":      0.1,
			"responseMimeType": "application/json",
			"responseSchema": map[string]any{
				"type": "ARRAY",
				"items": map[string]any{
					"type": "OBJECT",
					"properties": map[string]any{
						"id":         map[string]string{"type": "INTEGER"},
						"title":      map[string]string{"type": "STRING"},
						"artist":     map[string]string{"type": "STRING"},
						"confidence": map[string]any{"type": "STRING", "enum": []string{"high", "low"}},
					},
					"required": []string{"id", "title", "artist", "confidence"},
				},
			},
		},
	}
	raw, _ := json.Marshal(body)

	base := c.BaseURL
	if base == "" {
		base = "https://generativelanguage.googleapis.com"
	}
	model := c.Model
	if model == "" {
		model = "gemini-2.5-flash"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/v1beta/models/%s:generateContent", strings.TrimRight(base, "/"), model), bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-goog-api-key", c.Key)
	hc := c.HTTP
	if hc == nil {
		hc = &http.Client{Timeout: 60 * time.Second}
	}
	resp, err := hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("gemini request: %w", err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("gemini returned %d: %s", resp.StatusCode, truncate(string(data), 300))
	}
	return parseResponse(data, items)
}

func parseResponse(data []byte, items []Item) ([]Suggestion, error) {
	var env struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := json.Unmarshal(data, &env); err != nil {
		return nil, fmt.Errorf("gemini response: %w", err)
	}
	if len(env.Candidates) == 0 || len(env.Candidates[0].Content.Parts) == 0 {
		return nil, errors.New("gemini returned no answer")
	}
	var got []Suggestion
	if err := json.Unmarshal([]byte(env.Candidates[0].Content.Parts[0].Text), &got); err != nil {
		return nil, fmt.Errorf("gemini answer is not valid JSON: %w", err)
	}
	// Keep only ids we asked about, and fall back to the original for anything missing.
	byID := make(map[int64]Suggestion, len(got))
	for _, s := range got {
		byID[s.ID] = s
	}
	out := make([]Suggestion, 0, len(items))
	for _, it := range items {
		s, ok := byID[it.ID]
		s.Title, s.Artist = strings.TrimSpace(s.Title), strings.TrimSpace(s.Artist)
		if !ok || s.Title == "" {
			s = Suggestion{Title: it.Title, Artist: it.Artist, Confidence: "low"}
		}
		s.ID = it.ID
		if s.Confidence != "high" {
			s.Confidence = "low"
		}
		out = append(out, s)
	}
	return out, nil
}

func truncate(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}
