-- 11_evidence_advanced.sql (Member A): stored procedure, triggers, views
-- Runs after 01_evidence.sql (tables) and before 91_seed_evidence.sql (seed data).
-- Run through the mysql CLI (npm run db:init) so DELIMITER works.
USE shadowtrace;

-- ===========================================================================
-- 1. STORED PROCEDURE + TRANSACTION: transfer_custody
-- ===========================================================================
-- All-or-nothing: either (transfer row inserted AND custodian updated) or neither.
--
-- HOW THE LOCK WORKS (InnoDB row-level locking)
--   SELECT ... FOR UPDATE puts an EXCLUSIVE lock on the evidence row and keeps it until
--   COMMIT/ROLLBACK. A second session running the same SELECT ... FOR UPDATE on that row
--   WAITS (up to innodb_lock_wait_timeout = 50 s). When the first session commits, the
--   second one continues and reads the NEW custodian, so its "is p_from_user the current
--   custodian?" check fails. Two people can therefore never both hand over the same item.
--   Other evidence rows are not blocked (row lock, not table lock).
--
-- CALLER NOTE: START TRANSACTION inside a procedure silently COMMITS any transaction the
-- caller already opened. So the API must NOT wrap CALL in withTransaction(). Instead use one
-- pooled connection:  SET @app_user_id = ?;  CALL transfer_custody(?,?,?,?);
DELIMITER $$

CREATE PROCEDURE transfer_custody(
  IN p_evidence_id INT,
  IN p_from_user   INT,
  IN p_to_user     INT,
  IN p_reason      VARCHAR(255)
)
BEGIN
  DECLARE v_custodian INT;
  DECLARE v_status    VARCHAR(15);
  DECLARE v_active    BOOLEAN;

  -- Any error (including our own SIGNALs): undo everything, then pass the error to the caller.
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  -- Audit triggers read @app_user_id; default to the person handing the item over.
  IF @app_user_id IS NULL THEN
    SET @app_user_id = p_from_user;
  END IF;

  START TRANSACTION;

  -- Lock the evidence row. Nobody else can change or lock it until we finish.
  SELECT custodian_id, status INTO v_custodian, v_status
  FROM evidence
  WHERE id = p_evidence_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Evidence not found';
  END IF;

  IF v_status IN ('DESTROYED', 'RELEASED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Evidence is DESTROYED or RELEASED and cannot be transferred';
  END IF;

  IF v_custodian <> p_from_user THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'from_user is not the current custodian of this evidence';
  END IF;

  IF p_from_user = p_to_user THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cannot transfer evidence to the same user';
  END IF;

  SELECT is_active INTO v_active FROM users WHERE id = p_to_user;
  IF v_active IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Target user does not exist';
  END IF;
  IF v_active = FALSE THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Target user is inactive';
  END IF;

  -- Both writes happen inside the same transaction.
  INSERT INTO evidence_transfers (reason, evidence_id, from_user_id, to_user_id)
  VALUES (p_reason, p_evidence_id, p_from_user, p_to_user);

  UPDATE evidence SET custodian_id = p_to_user WHERE id = p_evidence_id;

  COMMIT;   -- releases the row lock
END$$

-- ===========================================================================
-- 2a. DATA-RULE TRIGGERS on evidence
-- (A CHECK cannot call NOW(), so "not in the future" needs a trigger.)
-- ===========================================================================
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

-- Tamper protection: the hash is the fingerprint of the evidence file; it can never change.
-- MySQL allows several triggers for the same event; FOLLOWS makes this one run second.
CREATE TRIGGER trg_evidence_bu_hash
BEFORE UPDATE ON evidence
FOR EACH ROW
FOLLOWS trg_evidence_bu_date
BEGIN
  IF NEW.file_hash <> OLD.file_hash THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'file_hash is immutable: evidence tampering blocked';
  END IF;
END$$

-- ===========================================================================
-- 2b. AUDIT TRIGGERS (AFTER = row is already saved, so target_id is known)
-- Acting user = session variable @app_user_id (NULL if the app did not set it).
-- ===========================================================================
CREATE TRIGGER trg_evidence_ai_audit
AFTER INSERT ON evidence
FOR EACH ROW
BEGIN
  INSERT INTO audit_logs (target_table, target_id, action, user_id)
  VALUES ('evidence', NEW.id, 'INSERT', @app_user_id);
END$$

CREATE TRIGGER trg_evidence_au_audit
AFTER UPDATE ON evidence
FOR EACH ROW
BEGIN
  INSERT INTO audit_logs (target_table, target_id, action, user_id)
  VALUES ('evidence', NEW.id, 'UPDATE', @app_user_id);
END$$

CREATE TRIGGER trg_evidence_ad_audit
AFTER DELETE ON evidence
FOR EACH ROW
BEGIN
  INSERT INTO audit_logs (target_table, target_id, action, user_id)
  VALUES ('evidence', OLD.id, 'DELETE', @app_user_id);   -- OLD: the row no longer exists
END$$

-- Logged against the EVIDENCE id so "history of evidence #7" (idx_audit_target) includes transfers.
CREATE TRIGGER trg_transfer_ai_audit
AFTER INSERT ON evidence_transfers
FOR EACH ROW
BEGIN
  INSERT INTO audit_logs (target_table, target_id, action, user_id)
  VALUES ('evidence', NEW.evidence_id, 'TRANSFER', @app_user_id);
END$$

-- ===========================================================================
-- 2c. APPEND-ONLY audit log: any UPDATE or DELETE is refused.
-- (TRUNCATE does not fire triggers; the app user must not be given DROP/TRUNCATE rights.)
-- ===========================================================================
CREATE TRIGGER trg_audit_bu_block
BEFORE UPDATE ON audit_logs
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only: UPDATE not allowed';
END$$

CREATE TRIGGER trg_audit_bd_block
BEFORE DELETE ON audit_logs
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only: DELETE not allowed';
END$$

DELIMITER ;

-- ===========================================================================
-- 3. VIEWS
-- ===========================================================================
-- Every transfer with readable names and its position in that evidence's chain (1 = first hand-over).
-- ROW_NUMBER() restarts at 1 for each evidence_id (PARTITION BY) in time order (ORDER BY).
CREATE VIEW v_chain_of_custody AS
SELECT
  tr.evidence_id,
  e.file_name,
  t.type_name,
  ROW_NUMBER() OVER (PARTITION BY tr.evidence_id ORDER BY tr.transferred_at, tr.id) AS transfer_seq,
  fu.full_name AS from_user,
  tu.full_name AS to_user,
  tr.reason,
  tr.transferred_at
FROM evidence_transfers tr
JOIN evidence       e  ON e.id  = tr.evidence_id
JOIN evidence_types t  ON t.id  = e.evidence_type_id
JOIN users          fu ON fu.id = tr.from_user_id
JOIN users          tu ON tu.id = tr.to_user_id;

-- Evidence with names instead of ids; used by the list page and search.
CREATE VIEW v_evidence_current AS
SELECT
  e.id,
  e.file_name,
  e.file_hash,
  e.status,
  t.type_name,
  c.full_name AS collected_by_name,
  h.full_name AS custodian_name,
  e.custodian_id,
  e.collected_at
FROM evidence e
JOIN evidence_types t ON t.id = e.evidence_type_id
JOIN users c ON c.id = e.collected_by
JOIN users h ON h.id = e.custodian_id;
