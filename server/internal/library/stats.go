package library

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// ---------- reporting ----------

type PlayDelta struct {
	TrackID int64  `json:"track_id"`
	Day     string `json:"day"` // YYYY-MM-DD in the device's local time
	Count   int    `json:"count"`
	At      int64  `json:"at"` // last play, unix ms
}

// RecordPlays adds play counts reported by a device. Only tracks the user can see are counted.
func (l *Library) RecordPlays(ctx context.Context, userID int64, plays []PlayDelta) error {
	visible := map[int64]bool{}
	for _, p := range plays {
		if p.Count <= 0 || p.Count > 10000 {
			continue
		}
		day, err := time.Parse("2006-01-02", p.Day)
		if err != nil || day.After(time.Now().Add(48*time.Hour)) {
			continue
		}
		ok, seen := visible[p.TrackID]
		if !seen {
			var err error
			if ok, err = l.CanSeeTrack(ctx, userID, p.TrackID); err != nil {
				return err
			}
			visible[p.TrackID] = ok
		}
		if !ok {
			continue
		}
		if _, err := l.DB.ExecContext(ctx, `
			INSERT INTO play_stats (user_id, track_id, plays, last_played_at) VALUES (?, ?, ?, ?)
			ON DUPLICATE KEY UPDATE plays = plays + VALUES(plays), last_played_at = GREATEST(last_played_at, VALUES(last_played_at))`,
			userID, p.TrackID, p.Count, p.At); err != nil {
			return err
		}
		if _, err := l.DB.ExecContext(ctx, `
			INSERT INTO play_daily (user_id, day, plays) VALUES (?, ?, ?)
			ON DUPLICATE KEY UPDATE plays = plays + VALUES(plays)`, userID, p.Day, p.Count); err != nil {
			return err
		}
	}
	return nil
}

// ---------- admin statistics ----------

type TopTrack struct {
	ID         int64  `json:"id"`
	Title      string `json:"title"`
	Artist     string `json:"artist"`
	Plays      int    `json:"plays"`
	Downloads  int    `json:"downloads"`
	Listeners  int    `json:"listeners"`
	LastPlayed int64  `json:"last_played_at"`
}

type TopArtist struct {
	Artist string `json:"artist"`
	Plays  int    `json:"plays"`
	Tracks int    `json:"tracks"`
}

type TopUser struct {
	ID        int64  `json:"id"`
	Email     string `json:"email"`
	Name      string `json:"name"`
	Plays     int    `json:"plays"`
	Downloads int    `json:"downloads"`
	LastSeen  int64  `json:"last_played_at"`
}

type DayPoint struct {
	Day   string `json:"day"`
	Plays int    `json:"plays"`
	Users int    `json:"users"`
}

type Overview struct {
	Days          int         `json:"days"`
	PlaysTotal    int64       `json:"plays_total"`
	PlaysPeriod   int64       `json:"plays_period"`
	Listeners     int64       `json:"listeners_period"`
	Downloads     int64       `json:"downloads_total"`
	Favorites     int64       `json:"favorites_total"`
	Daily         []DayPoint  `json:"daily"`
	TopTracks     []TopTrack  `json:"top_tracks"`
	TopDownloaded []TopTrack  `json:"top_downloaded"`
	TopArtists    []TopArtist `json:"top_artists"`
	TopUsers      []TopUser   `json:"top_users"`
}

func (l *Library) scanTopTracks(rows *sql.Rows) ([]TopTrack, error) {
	defer rows.Close()
	out := []TopTrack{}
	for rows.Next() {
		var t TopTrack
		if err := rows.Scan(&t.ID, &t.Title, &t.Artist, &t.Plays, &t.Downloads, &t.Listeners, &t.LastPlayed); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

const trackStatSelect = `
	SELECT t.id, t.title, t.artist,
		COALESCE(p.plays, 0), COALESCE(d.downloads, 0), COALESCE(p.listeners, 0), COALESCE(p.last, 0)
	FROM tracks t
	LEFT JOIN (SELECT track_id, SUM(plays) plays, COUNT(*) listeners, MAX(last_played_at) last FROM play_stats %s GROUP BY track_id) p ON p.track_id = t.id
	LEFT JOIN (SELECT track_id, SUM(downloads) downloads FROM download_history %s GROUP BY track_id) d ON d.track_id = t.id`

// Overview returns library-wide listening statistics for the last `days` days.
func (l *Library) Overview(ctx context.Context, days int) (*Overview, error) {
	o := &Overview{Days: days, Daily: []DayPoint{}}
	scan := func(q string, args ...any) *sql.Row { return l.DB.QueryRowContext(ctx, q, args...) }
	if err := scan(`SELECT COALESCE(SUM(plays), 0) FROM play_stats`).Scan(&o.PlaysTotal); err != nil {
		return nil, err
	}
	if err := scan(`SELECT COALESCE(SUM(plays), 0), COUNT(DISTINCT user_id) FROM play_daily WHERE day > CURDATE() - INTERVAL ? DAY`, days).Scan(&o.PlaysPeriod, &o.Listeners); err != nil {
		return nil, err
	}
	if err := scan(`SELECT COALESCE(SUM(downloads), 0) FROM download_history`).Scan(&o.Downloads); err != nil {
		return nil, err
	}
	if err := scan(`SELECT COUNT(*) FROM favorites WHERE deleted = FALSE`).Scan(&o.Favorites); err != nil {
		return nil, err
	}

	// A point for every day, including quiet ones, so the chart has no gaps.
	byDay := map[string]DayPoint{}
	rows, err := l.DB.QueryContext(ctx, `SELECT DATE_FORMAT(day, '%Y-%m-%d'), SUM(plays), COUNT(DISTINCT user_id) FROM play_daily WHERE day > CURDATE() - INTERVAL ? DAY GROUP BY day`, days)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var p DayPoint
		if err := rows.Scan(&p.Day, &p.Plays, &p.Users); err != nil {
			rows.Close()
			return nil, err
		}
		byDay[p.Day] = p
	}
	rows.Close()
	var today string
	if err := scan(`SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d')`).Scan(&today); err != nil {
		return nil, err
	}
	end, _ := time.Parse("2006-01-02", today)
	for i := days - 1; i >= 0; i-- {
		d := end.AddDate(0, 0, -i).Format("2006-01-02")
		p := byDay[d]
		p.Day = d
		o.Daily = append(o.Daily, p)
	}

	r, err := l.DB.QueryContext(ctx, fmt.Sprintf(trackStatSelect, "", "")+` WHERE p.plays > 0 ORDER BY p.plays DESC, t.id LIMIT 10`)
	if err != nil {
		return nil, err
	}
	if o.TopTracks, err = l.scanTopTracks(r); err != nil {
		return nil, err
	}
	r, err = l.DB.QueryContext(ctx, fmt.Sprintf(trackStatSelect, "", "")+` WHERE d.downloads > 0 ORDER BY d.downloads DESC, t.id LIMIT 10`)
	if err != nil {
		return nil, err
	}
	if o.TopDownloaded, err = l.scanTopTracks(r); err != nil {
		return nil, err
	}

	ar, err := l.DB.QueryContext(ctx, `
		SELECT t.artist, SUM(p.plays) plays, COUNT(DISTINCT t.id)
		FROM play_stats p JOIN tracks t ON t.id = p.track_id WHERE t.artist <> ''
		GROUP BY t.artist ORDER BY plays DESC LIMIT 8`)
	if err != nil {
		return nil, err
	}
	o.TopArtists = []TopArtist{}
	for ar.Next() {
		var a TopArtist
		if err := ar.Scan(&a.Artist, &a.Plays, &a.Tracks); err != nil {
			ar.Close()
			return nil, err
		}
		o.TopArtists = append(o.TopArtists, a)
	}
	ar.Close()

	ur, err := l.DB.QueryContext(ctx, `
		SELECT u.id, u.email, u.name,
			COALESCE((SELECT SUM(plays) FROM play_stats WHERE user_id = u.id), 0),
			COALESCE((SELECT SUM(downloads) FROM download_history WHERE user_id = u.id), 0),
			COALESCE((SELECT MAX(last_played_at) FROM play_stats WHERE user_id = u.id), 0)
		FROM users u ORDER BY 4 DESC, u.id LIMIT 8`)
	if err != nil {
		return nil, err
	}
	defer ur.Close()
	o.TopUsers = []TopUser{}
	for ur.Next() {
		var u TopUser
		if err := ur.Scan(&u.ID, &u.Email, &u.Name, &u.Plays, &u.Downloads, &u.LastSeen); err != nil {
			return nil, err
		}
		o.TopUsers = append(o.TopUsers, u)
	}
	return o, ur.Err()
}

type UserActivity struct {
	UserID        int64       `json:"user_id"`
	PlaysTotal    int64       `json:"plays_total"`
	PlaysPeriod   int64       `json:"plays_period"`
	Downloads     int64       `json:"downloads_total"`
	Favorites     int64       `json:"favorites_total"`
	UniqueTracks  int64       `json:"unique_tracks"`
	LastPlayed    int64       `json:"last_played_at"`
	Daily         []DayPoint  `json:"daily"`
	TopPlayed     []TopTrack  `json:"top_played"`
	TopDownloaded []TopTrack  `json:"top_downloaded"`
	TopArtists    []TopArtist `json:"top_artists"`
}

// Activity returns what one user listens to and downloads.
func (l *Library) Activity(ctx context.Context, userID int64, days int) (*UserActivity, error) {
	a := &UserActivity{UserID: userID, Daily: []DayPoint{}}
	err := l.DB.QueryRowContext(ctx, `SELECT COALESCE(SUM(plays), 0), COUNT(*), COALESCE(MAX(last_played_at), 0) FROM play_stats WHERE user_id = ?`, userID).
		Scan(&a.PlaysTotal, &a.UniqueTracks, &a.LastPlayed)
	if err != nil {
		return nil, err
	}
	if err := l.DB.QueryRowContext(ctx, `SELECT COALESCE(SUM(plays), 0) FROM play_daily WHERE user_id = ? AND day > CURDATE() - INTERVAL ? DAY`, userID, days).Scan(&a.PlaysPeriod); err != nil {
		return nil, err
	}
	if err := l.DB.QueryRowContext(ctx, `SELECT COALESCE(SUM(downloads), 0) FROM download_history WHERE user_id = ?`, userID).Scan(&a.Downloads); err != nil {
		return nil, err
	}
	if err := l.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM favorites WHERE user_id = ? AND deleted = FALSE`, userID).Scan(&a.Favorites); err != nil {
		return nil, err
	}

	byDay := map[string]int{}
	rows, err := l.DB.QueryContext(ctx, `SELECT DATE_FORMAT(day, '%Y-%m-%d'), plays FROM play_daily WHERE user_id = ? AND day > CURDATE() - INTERVAL ? DAY`, userID, days)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var d string
		var n int
		if err := rows.Scan(&d, &n); err != nil {
			rows.Close()
			return nil, err
		}
		byDay[d] = n
	}
	rows.Close()
	var today string
	if err := l.DB.QueryRowContext(ctx, `SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d')`).Scan(&today); err != nil {
		return nil, err
	}
	end, _ := time.Parse("2006-01-02", today)
	for i := days - 1; i >= 0; i-- {
		d := end.AddDate(0, 0, -i).Format("2006-01-02")
		a.Daily = append(a.Daily, DayPoint{Day: d, Plays: byDay[d]})
	}

	played := fmt.Sprintf(trackStatSelect, "WHERE user_id = ?", "WHERE user_id = ?")
	r, err := l.DB.QueryContext(ctx, played+` WHERE p.plays > 0 ORDER BY p.plays DESC, t.id LIMIT 20`, userID, userID)
	if err != nil {
		return nil, err
	}
	if a.TopPlayed, err = l.scanTopTracks(r); err != nil {
		return nil, err
	}
	r, err = l.DB.QueryContext(ctx, played+` WHERE d.downloads > 0 ORDER BY d.downloads DESC, t.id LIMIT 20`, userID, userID)
	if err != nil {
		return nil, err
	}
	if a.TopDownloaded, err = l.scanTopTracks(r); err != nil {
		return nil, err
	}

	ar, err := l.DB.QueryContext(ctx, `
		SELECT t.artist, SUM(p.plays) plays, COUNT(*) FROM play_stats p JOIN tracks t ON t.id = p.track_id
		WHERE p.user_id = ? AND t.artist <> '' GROUP BY t.artist ORDER BY plays DESC LIMIT 6`, userID)
	if err != nil {
		return nil, err
	}
	defer ar.Close()
	a.TopArtists = []TopArtist{}
	for ar.Next() {
		var x TopArtist
		if err := ar.Scan(&x.Artist, &x.Plays, &x.Tracks); err != nil {
			return nil, err
		}
		a.TopArtists = append(a.TopArtists, x)
	}
	return a, ar.Err()
}
