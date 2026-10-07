package library

import (
	"context"
	"database/sql"
	"errors"
	"math/rand"
)

// RecTrack is a song a recommendation can contain.
type RecTrack struct {
	ID     int64
	Title  string
	Artist string
	Plays  int
}

// TasteAndCandidates returns the user's most played songs and a pool of songs
// they can see but have not played much, which recommendations are drawn from.
func (l *Library) TasteAndCandidates(ctx context.Context, userID int64, maxCandidates int) (taste, candidates []RecTrack, err error) {
	rows, err := l.DB.QueryContext(ctx, `
		SELECT t.id, t.title, t.artist, p.plays FROM play_stats p JOIN tracks t ON t.id = p.track_id
		WHERE p.user_id = ? ORDER BY p.plays DESC, p.last_played_at DESC LIMIT 15`, userID)
	if err != nil {
		return nil, nil, err
	}
	for rows.Next() {
		var t RecTrack
		if err := rows.Scan(&t.ID, &t.Title, &t.Artist, &t.Plays); err != nil {
			rows.Close()
			return nil, nil, err
		}
		taste = append(taste, t)
	}
	rows.Close()

	// Favorites count as taste too, so a brand new listener still gets a useful feed.
	if len(taste) < 5 {
		fr, err := l.DB.QueryContext(ctx, `
			SELECT t.id, t.title, t.artist FROM favorites f JOIN tracks t ON t.id = f.track_id
			WHERE f.user_id = ? AND f.deleted = FALSE ORDER BY f.added_at DESC LIMIT 10`, userID)
		if err != nil {
			return nil, nil, err
		}
		for fr.Next() {
			var t RecTrack
			if err := fr.Scan(&t.ID, &t.Title, &t.Artist); err != nil {
				fr.Close()
				return nil, nil, err
			}
			taste = append(taste, t)
		}
		fr.Close()
	}

	vis, err := l.VisibleFolderIDs(ctx, userID)
	if err != nil || len(vis) == 0 {
		return taste, nil, err
	}
	in, args := inClause(vis)
	cr, err := l.DB.QueryContext(ctx, `
		SELECT t.id, t.title, t.artist, COALESCE(p.plays, 0) FROM tracks t
		LEFT JOIN play_stats p ON p.track_id = t.id AND p.user_id = ?
		WHERE t.id IN (SELECT track_id FROM folder_tracks WHERE deleted_at IS NULL AND folder_id IN `+in+`)
		ORDER BY COALESCE(p.plays, 0), t.id DESC LIMIT ?`, append(append([]any{userID}, args...), maxCandidates)...)
	if err != nil {
		return nil, nil, err
	}
	defer cr.Close()
	for cr.Next() {
		var t RecTrack
		if err := cr.Scan(&t.ID, &t.Title, &t.Artist, &t.Plays); err != nil {
			return nil, nil, err
		}
		candidates = append(candidates, t)
	}
	return taste, candidates, cr.Err()
}

// ArtistShelf is the no-AI fallback: unplayed songs by the artists the user plays most,
// then a shuffle of other songs to discover.
func ArtistShelf(taste, candidates []RecTrack, titleArtist, titleDiscover string, perShelf int) [][3]any {
	fav := map[string]bool{}
	for _, t := range taste {
		if t.Artist != "" {
			fav[t.Artist] = true
		}
	}
	var like, rest []int64
	for _, c := range candidates {
		if c.Plays > 1 {
			continue
		}
		if fav[c.Artist] {
			like = append(like, c.ID)
		} else {
			rest = append(rest, c.ID)
		}
	}
	rand.Shuffle(len(like), func(i, j int) { like[i], like[j] = like[j], like[i] })
	rand.Shuffle(len(rest), func(i, j int) { rest[i], rest[j] = rest[j], rest[i] })
	out := [][3]any{}
	if len(like) > 0 {
		out = append(out, [3]any{titleArtist, "", firstN(like, perShelf)})
	}
	if len(rest) > 0 {
		out = append(out, [3]any{titleDiscover, "", firstN(rest, perShelf)})
	}
	return out
}

func firstN(ids []int64, n int) []int64 {
	if len(ids) > n {
		return ids[:n]
	}
	return ids
}

// ---------- cache ----------

func (l *Library) CachedRecommendations(ctx context.Context, userID int64, lang string, maxAgeMs, now int64) (string, bool, error) {
	var payload string
	var created int64
	var cachedLang string
	err := l.DB.QueryRowContext(ctx, `SELECT payload, created_at, lang FROM recommendations WHERE user_id = ?`, userID).Scan(&payload, &created, &cachedLang)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return payload, cachedLang == lang && now-created < maxAgeMs, nil
}

func (l *Library) SaveRecommendations(ctx context.Context, userID int64, lang, payload string, now int64) error {
	_, err := l.DB.ExecContext(ctx, `
		INSERT INTO recommendations (user_id, lang, payload, created_at) VALUES (?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE lang = VALUES(lang), payload = VALUES(payload), created_at = VALUES(created_at)`, userID, lang, payload, now)
	return err
}
