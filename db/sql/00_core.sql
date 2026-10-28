-- 00_core.sql (Member B): database, roles, users, investigations, events, assets
CREATE DATABASE IF NOT EXISTS shadowtrace CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE shadowtrace;

CREATE TABLE roles (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  role_name   VARCHAR(30)  NOT NULL UNIQUE,
  description VARCHAR(255) NULL,
  CONSTRAINT chk_role_name CHECK (role_name IN ('ADMIN','INVESTIGATOR','ANALYST'))
) ENGINE=InnoDB;

CREATE TABLE users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  full_name     VARCHAR(100) NOT NULL,
  email         VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,            -- bcrypt hash, never plain text
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  role_id       INT          NOT NULL,
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id),
  CONSTRAINT chk_users_email CHECK (email REGEXP '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$'),
  CONSTRAINT chk_users_name  CHECK (CHAR_LENGTH(TRIM(full_name)) >= 2)
) ENGINE=InnoDB;

CREATE TABLE investigations (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  title                VARCHAR(200) NOT NULL,
  case_code            VARCHAR(20)  NOT NULL UNIQUE,
  severity             VARCHAR(10)  NOT NULL DEFAULT 'MEDIUM',
  status               VARCHAR(10)  NOT NULL DEFAULT 'OPEN',
  opened_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at            DATETIME     NULL,
  lead_investigator_id INT          NOT NULL,
  CONSTRAINT fk_inv_lead FOREIGN KEY (lead_investigator_id) REFERENCES users(id),
  CONSTRAINT chk_inv_code     CHECK (case_code REGEXP '^CASE-[0-9]{4}-[0-9]{3}$'),
  CONSTRAINT chk_inv_severity CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  CONSTRAINT chk_inv_status   CHECK (status IN ('OPEN','ACTIVE','CLOSED')),
  CONSTRAINT chk_inv_dates    CHECK (closed_at IS NULL OR closed_at >= opened_at),
  CONSTRAINT chk_inv_closed   CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL))
) ENGINE=InnoDB;

CREATE TABLE investigation_events (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  event_type       VARCHAR(30) NOT NULL,
  event_time       DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  description      TEXT        NULL,
  investigation_id INT         NOT NULL,
  CONSTRAINT fk_event_inv FOREIGN KEY (investigation_id) REFERENCES investigations(id) ON DELETE CASCADE,
  CONSTRAINT chk_event_type CHECK (event_type IN ('OPENED','EVIDENCE_ADDED','TRANSFER','NOTE','STATUS_CHANGE','CLOSED'))
) ENGINE=InnoDB;

CREATE TABLE assets (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  asset_type  VARCHAR(30)  NOT NULL,
  identifier  VARCHAR(150) NOT NULL,              -- e.g. IP address, serial number, account name
  description VARCHAR(255) NULL,
  CONSTRAINT chk_asset_type CHECK (asset_type IN ('DEVICE','IP_ADDRESS','ACCOUNT','DOMAIN','PERSON')),
  UNIQUE KEY uq_asset (asset_type, identifier)
) ENGINE=InnoDB;
