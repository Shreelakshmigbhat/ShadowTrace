-- 01_evidence.sql (Member A): evidence_types, evidence, evidence_transfers, audit_logs
-- Runs after 00_core.sql (needs users). Link tables to investigations come later in 02_links.sql.
USE shadowtrace;

-- ---------------------------------------------------------------------------
-- evidence_types: lookup table (Disk Image, Mobile Device, ...). UNIQUE stops duplicate type names.
-- ---------------------------------------------------------------------------
CREATE TABLE evidence_types (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  type_name VARCHAR(50) NOT NULL UNIQUE,
  CONSTRAINT chk_etype_name CHECK (CHAR_LENGTH(TRIM(type_name)) > 0)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- evidence: one row per seized digital item.
-- ---------------------------------------------------------------------------
CREATE TABLE evidence (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  status           VARCHAR(15)  NOT NULL DEFAULT 'COLLECTED',
  file_hash        CHAR(64)     NOT NULL,
  file_name        VARCHAR(255) NOT NULL,
  collected_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  evidence_type_id INT          NOT NULL,
  collected_by     INT          NOT NULL,   -- never changes: who originally seized it
  custodian_id     INT          NOT NULL,   -- changes: who holds it right now

  CONSTRAINT uq_evidence_hash UNIQUE (file_hash),   -- same file cannot be registered twice

  CONSTRAINT chk_ev_status CHECK (status IN ('COLLECTED','IN_ANALYSIS','IN_STORAGE','RELEASED','DESTROYED')),
  -- REGEXP_LIKE with 'c' = case-SENSITIVE match. Plain REGEXP follows the column collation
  -- (utf8mb4_unicode_ci is case-insensitive), so it would let uppercase hex through.
  CONSTRAINT chk_ev_hash CHECK (REGEXP_LIKE(file_hash, '^[0-9a-f]{64}$', 'c')),
  CONSTRAINT chk_ev_file CHECK (CHAR_LENGTH(TRIM(file_name)) > 0),

  -- ON DELETE RESTRICT (the default, written out so it is visible):
  -- you cannot delete a type or a user while evidence still points to them.
  CONSTRAINT fk_ev_type      FOREIGN KEY (evidence_type_id) REFERENCES evidence_types(id) ON DELETE RESTRICT,
  CONSTRAINT fk_ev_collector FOREIGN KEY (collected_by)     REFERENCES users(id)          ON DELETE RESTRICT,
  CONSTRAINT fk_ev_custodian FOREIGN KEY (custodian_id)     REFERENCES users(id)          ON DELETE RESTRICT,

  INDEX idx_ev_custodian (custodian_id),     -- "what does this person hold?" / HAVING COUNT per custodian
  INDEX idx_ev_status    (status),           -- status filter on the evidence list and dashboard counts
  INDEX idx_ev_type      (evidence_type_id)  -- join to evidence_types, GROUP BY type
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- evidence_transfers: the chain of custody. Rows are only ever INSERTed, never edited or deleted.
-- ---------------------------------------------------------------------------
CREATE TABLE evidence_transfers (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  reason         VARCHAR(255) NOT NULL,
  transferred_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  evidence_id    INT NOT NULL,
  from_user_id   INT NOT NULL,
  to_user_id     INT NOT NULL,

  CONSTRAINT chk_tr_diff   CHECK (from_user_id <> to_user_id),       -- cannot hand it to yourself
  CONSTRAINT chk_tr_reason CHECK (CHAR_LENGTH(TRIM(reason)) >= 5),   -- a real reason, not "x"

  CONSTRAINT fk_tr_evidence FOREIGN KEY (evidence_id)  REFERENCES evidence(id) ON DELETE RESTRICT,
  CONSTRAINT fk_tr_from     FOREIGN KEY (from_user_id) REFERENCES users(id)    ON DELETE RESTRICT,
  CONSTRAINT fk_tr_to       FOREIGN KEY (to_user_id)   REFERENCES users(id)    ON DELETE RESTRICT,

  -- Newest-first history of one evidence item; also serves "latest transfer" (MAX(transferred_at)).
  -- MySQL 8 supports real DESC index columns.
  INDEX idx_tr_evidence_time (evidence_id, transferred_at DESC)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- audit_logs: who did what to which row. Written by triggers (11_evidence_advanced.sql) and the app.
-- user_id is nullable: failed LOGINs and system jobs have no logged-in user.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  target_table VARCHAR(50) NOT NULL,
  target_id    INT         NOT NULL,
  action       VARCHAR(10) NOT NULL,
  created_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_id      INT         NULL,

  CONSTRAINT chk_audit_action CHECK (action IN ('INSERT','UPDATE','DELETE','TRANSFER','LOGIN')),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,

  INDEX idx_audit_target (target_table, target_id)  -- "show the history of evidence #7"
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- "collected_at must not be in the future": a CHECK cannot call NOW(), so use triggers.
-- One trigger per event (MySQL allows only one event per trigger).
-- ---------------------------------------------------------------------------
DELIMITER $$

CREATE TRIGGER trg_evidence_bi_date
BEFORE INSERT ON evidence
FOR EACH ROW
BEGIN
  IF NEW.collected_at > NOW() THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'collected_at cannot be in the future';
  END IF;
END$$

CREATE TRIGGER trg_evidence_bu_date
BEFORE UPDATE ON evidence
FOR EACH ROW
BEGIN
  IF NEW.collected_at > NOW() THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'collected_at cannot be in the future';
  END IF;
END$$

DELIMITER ;
