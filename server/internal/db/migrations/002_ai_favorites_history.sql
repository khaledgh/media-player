ALTER TABLE youtube_jobs ADD COLUMN ai_lang VARCHAR(2) NULL;

-- Per-user favorites, optionally grouped in flat folders. Rows are synced by
-- last-write-wins on the device clock (updated_at, unix ms) and soft-deleted.
CREATE TABLE favorite_folders (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT NOT NULL,
  name       VARCHAR(255) NOT NULL,
  updated_at BIGINT NOT NULL,
  deleted    BOOLEAN NOT NULL DEFAULT FALSE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_favfolders_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE favorites (
  user_id    BIGINT NOT NULL,
  track_id   BIGINT NOT NULL,
  folder_id  BIGINT NULL,
  added_at   BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  deleted    BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (user_id, track_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE,
  FOREIGN KEY (folder_id) REFERENCES favorite_folders(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Tracks a user has downloaded to a device, so a new device can offer them again.
CREATE TABLE download_history (
  user_id            BIGINT NOT NULL,
  track_id           BIGINT NOT NULL,
  last_downloaded_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, track_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
