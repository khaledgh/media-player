CREATE TABLE users (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(255) NOT NULL DEFAULT '',
  role          ENUM('admin','user') NOT NULL DEFAULT 'user',
  disabled      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE refresh_tokens (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT NOT NULL,
  token_hash   CHAR(64) NOT NULL UNIQUE,
  device_name  VARCHAR(255) NOT NULL DEFAULT '',
  expires_at   DATETIME(3) NOT NULL,
  last_used_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked      BOOLEAN NOT NULL DEFAULT FALSE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE user_groups (
  id   BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE user_group_members (
  group_id BIGINT NOT NULL,
  user_id  BIGINT NOT NULL,
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (group_id) REFERENCES user_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Global monotonically increasing revision used as the sync cursor.
CREATE TABLE rev_counter (
  id INT PRIMARY KEY,
  v  BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT INTO rev_counter (id, v) VALUES (1, 0);

-- owner_user_id NULL = admin/shared folder managed in the CMS.
CREATE TABLE folders (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  owner_user_id BIGINT NULL,
  parent_id     BIGINT NULL,
  name          VARCHAR(255) NOT NULL,
  sort_order    INT NOT NULL DEFAULT 0,
  sort_mode     VARCHAR(32) NOT NULL DEFAULT 'custom',
  auto_download BOOLEAN NOT NULL DEFAULT TRUE,
  rev           BIGINT NOT NULL,
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at    DATETIME(3) NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE,
  INDEX idx_folders_owner_rev (owner_user_id, rev),
  INDEX idx_folders_parent (parent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE tracks (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  sha256       CHAR(64) NOT NULL UNIQUE,
  object_key   VARCHAR(512) NOT NULL,
  cover_key    VARCHAR(512) NULL,
  title        VARCHAR(512) NOT NULL,
  artist       VARCHAR(512) NOT NULL DEFAULT '',
  album        VARCHAR(512) NOT NULL DEFAULT '',
  duration_ms  INT NOT NULL DEFAULT 0,
  size_bytes   BIGINT NOT NULL DEFAULT 0,
  mime         VARCHAR(64) NOT NULL,
  source       ENUM('upload','youtube') NOT NULL DEFAULT 'upload',
  source_url   VARCHAR(1024) NULL,
  rev          BIGINT NOT NULL,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_tracks_source_url (source_url(255))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE folder_tracks (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  folder_id  BIGINT NOT NULL,
  track_id   BIGINT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  rev        BIGINT NOT NULL,
  added_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  UNIQUE KEY uq_folder_track (folder_id, track_id),
  FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE,
  FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE,
  INDEX idx_ft_rev (rev)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Grants an admin folder (and its subtree) to a user or a group.
CREATE TABLE folder_access (
  id        BIGINT AUTO_INCREMENT PRIMARY KEY,
  folder_id BIGINT NOT NULL,
  user_id   BIGINT NULL,
  group_id  BIGINT NULL,
  UNIQUE KEY uq_access (folder_id, user_id, group_id),
  FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES user_groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE youtube_jobs (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT NOT NULL,
  url        VARCHAR(1024) NOT NULL,
  folder_id  BIGINT NOT NULL,
  status     ENUM('queued','running','done','error') NOT NULL DEFAULT 'queued',
  error      TEXT NULL,
  track_id   BIGINT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE,
  INDEX idx_yt_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE import_jobs (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  folder_id   BIGINT NOT NULL,
  file_name   VARCHAR(512) NOT NULL,
  status      ENUM('queued','running','done','error') NOT NULL DEFAULT 'queued',
  total       INT NOT NULL DEFAULT 0,
  processed   INT NOT NULL DEFAULT 0,
  failed      INT NOT NULL DEFAULT 0,
  error       TEXT NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
