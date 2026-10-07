-- Listening statistics reported by the apps (deltas, summed on the server).
CREATE TABLE play_stats (
  user_id        BIGINT NOT NULL,
  track_id       BIGINT NOT NULL,
  plays          INT NOT NULL DEFAULT 0,
  last_played_at BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, track_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE,
  INDEX idx_play_stats_track (track_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE play_daily (
  user_id BIGINT NOT NULL,
  day     DATE NOT NULL,
  plays   INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_play_daily_day (day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE download_history ADD COLUMN downloads INT NOT NULL DEFAULT 1;

-- AI recommendations are cached per user so Gemini is not called on every app start.
CREATE TABLE recommendations (
  user_id    BIGINT PRIMARY KEY,
  lang       VARCHAR(2) NOT NULL,
  payload    MEDIUMTEXT NOT NULL,
  created_at BIGINT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
