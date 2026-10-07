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

type Candidate struct {
	ID     int64  `json:"id"`
	Title  string `json:"title"`
	Artist string `json:"artist"`
}

type TasteItem struct {
	Title  string `json:"title"`
	Artist string `json:"artist"`
	Plays  int    `json:"plays"`
}

type Section struct {
	Title    string  `json:"title"`
	Reason   string  `json:"reason"`
	TrackIDs []int64 `json:"track_ids"`
}

// Recommend asks Gemini to build "For you" shelves out of the candidate songs,
// based on what the user plays most. It only returns ids from candidates.
func (c *Client) Recommend(ctx context.Context, taste []TasteItem, candidates []Candidate, lang string) ([]Section, error) {
	if !c.Enabled() {
		return nil, ErrDisabled
	}
	langName, ok := LangName(lang)
	if !ok {
		return nil, fmt.Errorf("unsupported language %q", lang)
	}
	t, _ := json.Marshal(taste)
	cand, _ := json.Marshal(candidates)
	prompt := "You are the music curator of a personal music app.\n" +
		"Below is what the listener plays most (with play counts) and a list of candidate songs from their library.\n" +
		"Build 3 to 4 recommendation shelves from the candidates only. Each shelf has a short, friendly title written in " + langName +
		" (like \"Because you love Fairuz\", \"Calm evening\", \"Upbeat for the road\"), a one-sentence reason in " + langName +
		", and 6 to 12 candidate ids that fit the listener's taste and each other.\n" +
		"Rules:\n- Use only ids from the candidate list. Never invent ids.\n- Do not repeat a song across shelves.\n" +
		"- Prefer artists and moods the listener already likes, and mix in a few close discoveries.\n\n" +
		"Most played:\n" + string(t) + "\n\nCandidates:\n" + string(cand)

	body := map[string]any{
		"contents": []any{map[string]any{"parts": []any{map[string]string{"text": prompt}}}},
		"generationConfig": map[string]any{
			"temperature":      0.6,
			"responseMimeType": "application/json",
			"responseSchema": map[string]any{
				"type": "ARRAY",
				"items": map[string]any{
					"type": "OBJECT",
					"properties": map[string]any{
						"title":     map[string]string{"type": "STRING"},
						"reason":    map[string]string{"type": "STRING"},
						"track_ids": map[string]any{"type": "ARRAY", "items": map[string]string{"type": "INTEGER"}},
					},
					"required": []string{"title", "reason", "track_ids"},
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
	return parseSections(data, candidates)
}

func parseSections(data []byte, candidates []Candidate) ([]Section, error) {
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
	var got []Section
	if err := json.Unmarshal([]byte(env.Candidates[0].Content.Parts[0].Text), &got); err != nil {
		return nil, fmt.Errorf("gemini answer is not valid JSON: %w", err)
	}
	allowed := make(map[int64]bool, len(candidates))
	for _, c := range candidates {
		allowed[c.ID] = true
	}
	used := map[int64]bool{}
	out := []Section{}
	for _, s := range got {
		ids := []int64{}
		for _, id := range s.TrackIDs {
			if allowed[id] && !used[id] {
				used[id] = true
				ids = append(ids, id)
			}
		}
		s.Title = strings.TrimSpace(s.Title)
		if s.Title == "" || len(ids) < 3 {
			continue
		}
		s.TrackIDs, s.Reason = ids, strings.TrimSpace(s.Reason)
		out = append(out, s)
	}
	if len(out) == 0 {
		return nil, errors.New("gemini returned no usable recommendations")
	}
	return out, nil
}
