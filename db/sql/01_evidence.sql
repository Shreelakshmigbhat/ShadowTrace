-- 01_evidence.sql (Member A): evidence types, evidence, custody transfers, audit log
USE shadowtrace;

CREATE TABLE evidence_types (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  type_name VARCHAR(50) NOT NULL UNIQUE           -- e.g. DISK_IMAGE, MOBILE_IMAGE, PCAP
) ENGINE=InnoDB;

CREATE TABLE evidence (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  status           VARCHAR(15)  NOT NULL DEFAULT 'COLLECTED',
  file_hash        CHAR(64)     NOT NULL UNIQUE,  -- SHA-256 in hex; UNIQUE blocks duplicate evidence
  file_name        VARCHAR(255) NOT NULL,
  collected_at     DATETIME     NOT NULL,
  evidence_type_id INT          NOT NULL,
  collected_by     INT          NOT NULL,
  custodian_id     INT          NOT NULL,         -- who currently holds the evidence
  CONSTRAINT fk_ev_type      FOREIGN KEY (evidence_type_id) REFERENCES evidence_types(id),
  CONSTRAINT fk_ev_collector FOREIGN KEY (collected_by)     REFERENCES users(id),
  CONSTRAINT fk_ev_custodian FOREIGN KEY (custodian_id)     REFERENCES users(id),
  CONSTRAINT chk_ev_status CHECK (status IN ('COLLECTED','IN_ANALYSIS','ANALYZED','ARCHIVED')),
  CONSTRAINT chk_ev_hash   CHECK (file_hash REGEXP '^[0-9a-fA-F]{64}$'),
  CONSTRAINT chk_ev_file   CHECK (CHAR_LENGTH(TRIM(file_name)) > 0),
  INDEX idx_ev_status (status),
  INDEX idx_ev_custodian (custodian_id)
) ENGINE=InnoDB;

CREATE TABLE evidence_transfers (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  reason         VARCHAR(255) NOT NULL,
  transferred_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  evidence_id    INT NOT NULL,
  from_user_id   INT NOT NULL,
  to_user_id     INT NOT NULL,
  CONSTRAINT fk_tr_evidence FOREIGN KEY (evidence_id)  REFERENCES evidence(id),
  CONSTRAINT fk_tr_from     FOREIGN KEY (from_user_id) REFERENCES users(id),
  CONSTRAINT fk_tr_to       FOREIGN KEY (to_user_id)   REFERENCES users(id),
  CONSTRAINT chk_tr_diff    CHECK (from_user_id <> to_user_id),   -- cannot hand evidence to yourself
  INDEX idx_tr_evidence (evidence_id, transferred_at)
) ENGINE=InnoDB;

CREATE TABLE audit_logs (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  target_table VARCHAR(50) NOT NULL,
  target_id    INT         NOT NULL,
  action       VARCHAR(10) NOT NULL,
  created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_id      INT         NULL,                  -- NULL if @app_user_id was not set
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT chk_audit_action CHECK (action IN ('INSERT','UPDATE','DELETE')),
  INDEX idx_audit_target (target_table, target_id)
) ENGINE=InnoDB;
