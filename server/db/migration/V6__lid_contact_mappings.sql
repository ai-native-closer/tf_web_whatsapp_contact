CREATE TABLE IF NOT EXISTS wa_lid_mappings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_id BIGINT UNSIGNED NOT NULL,
  lid_chat_id VARCHAR(120) NOT NULL,
  phone_chat_id VARCHAR(120) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_wa_lid_mappings_account_lid (account_id, lid_chat_id),
  KEY idx_wa_lid_mappings_account_phone (account_id, phone_chat_id),
  CONSTRAINT fk_wa_lid_mappings_account FOREIGN KEY (account_id) REFERENCES wa_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
