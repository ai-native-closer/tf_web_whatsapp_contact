CREATE TABLE IF NOT EXISTS wa_admin_users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(64) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  status ENUM('enabled', 'disabled') NOT NULL DEFAULT 'enabled',
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_wa_admin_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wa_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_id VARCHAR(64) NOT NULL,
  client_id VARCHAR(128) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  phone_hint VARCHAR(32) NULL,
  status ENUM('enabled', 'disabled', 'deleted') NOT NULL DEFAULT 'enabled',
  login_state ENUM('new', 'initializing', 'qr', 'pairing', 'authenticated', 'ready', 'auth_failure', 'disconnected', 'logged_out') NOT NULL DEFAULT 'new',
  is_current TINYINT(1) NOT NULL DEFAULT 0,
  last_seen_at DATETIME NULL,
  last_qr_at DATETIME NULL,
  disabled_at DATETIME NULL,
  deleted_at DATETIME NULL,
  remark TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_wa_accounts_account_id (account_id),
  UNIQUE KEY uk_wa_accounts_client_id (client_id),
  KEY idx_wa_accounts_status (status),
  KEY idx_wa_accounts_current (is_current)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wa_send_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_id BIGINT UNSIGNED NOT NULL,
  mode ENUM('single', 'automatic', 'manual') NOT NULL,
  status ENUM('queued', 'running', 'manual_waiting', 'paused', 'stopped', 'completed', 'failed') NOT NULL DEFAULT 'queued',
  message_text LONGTEXT NOT NULL,
  interval_ms INT UNSIGNED NOT NULL DEFAULT 5000,
  daily_limit INT UNSIGNED NOT NULL DEFAULT 80,
  retry_limit INT UNSIGNED NOT NULL DEFAULT 1,
  total_count INT UNSIGNED NOT NULL DEFAULT 0,
  pending_count INT UNSIGNED NOT NULL DEFAULT 0,
  sent_count INT UNSIGNED NOT NULL DEFAULT 0,
  failed_count INT UNSIGNED NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  created_by BIGINT UNSIGNED NULL,
  started_at DATETIME NULL,
  finished_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_wa_send_jobs_account_status (account_id, status),
  KEY idx_wa_send_jobs_created_at (created_at),
  CONSTRAINT fk_wa_send_jobs_account FOREIGN KEY (account_id) REFERENCES wa_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wa_send_job_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_id BIGINT UNSIGNED NOT NULL,
  recipient_phone VARCHAR(32) NOT NULL,
  chat_id VARCHAR(80) NULL,
  status ENUM('pending', 'sending', 'sent', 'failed', 'skipped', 'canceled') NOT NULL DEFAULT 'pending',
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  message_id VARCHAR(180) NULL,
  error_message TEXT NULL,
  sent_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_wa_send_job_items_job_status (job_id, status),
  KEY idx_wa_send_job_items_phone (recipient_phone),
  CONSTRAINT fk_wa_send_job_items_job FOREIGN KEY (job_id) REFERENCES wa_send_jobs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wa_audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_user_id BIGINT UNSIGNED NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(60) NOT NULL,
  entity_id VARCHAR(80) NULL,
  detail_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_wa_audit_logs_created_at (created_at),
  KEY idx_wa_audit_logs_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

