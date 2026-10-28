-- evidence_tests.sql (Member A): statements that SHOULD fail and SHOULD succeed.
-- Run AFTER `npm run db:reset` (schema + seeds). Assumes users 1-8 exist and are active,
-- and evidence #6 is held by user 4 (see 91_seed_evidence.sql).
--
-- HOW TO RUN: one block at a time in a MySQL client (so you can screenshot each result), or
--   docker exec -i -e MYSQL_PWD=<pw> shadowtrace-mysql mysql --force --table -u<user> shadowtrace < db/tests/evidence_tests.sql
-- (--force keeps going after an error so you see every expected failure.)
USE shadowtrace;
SET @app_user_id = 2;   -- pretend user 2 is the logged-in user; audit triggers will record this

-- ======================= SHOULD FAIL =======================

-- F1. Bad hash (too short)
-- EXPECT: ERROR 3819 Check constraint 'chk_ev_hash' is violated.
INSERT INTO evidence (file_hash, file_name, evidence_type_id, collected_by, custodian_id)
VALUES ('abc123', 'bad_hash.E01', 1, 2, 2);

-- F2. Bad hash (right length but UPPERCASE: the 'c' flag makes the check case-sensitive)
-- EXPECT: ERROR 3819 Check constraint 'chk_ev_hash' is violated.
INSERT INTO evidence (file_hash, file_name, evidence_type_id, collected_by, custodian_id)
VALUES (UPPER(SHA2('upper', 256)), 'upper.E01', 1, 2, 2);

-- F3. Duplicate hash (same file registered twice)
-- EXPECT: ERROR 1062 Duplicate entry '...' for key 'evidence.uq_evidence_hash'.
INSERT INTO evidence (file_hash, file_name, evidence_type_id, collected_by, custodian_id)
SELECT file_hash, 'copy_of_first.E01', 1, 2, 2 FROM evidence WHERE id = 1;

-- F4. collected_at in the future
-- EXPECT: ERROR 1644 (45000) collected_at cannot be in the future
INSERT INTO evidence (file_hash, file_name, collected_at, evidence_type_id, collected_by, custodian_id)
VALUES (SHA2('future', 256), 'future.E01', NOW() + INTERVAL 1 DAY, 1, 2, 2);

-- F5. Self-transfer written directly into the table
-- EXPECT: ERROR 3819 Check constraint 'chk_tr_diff' is violated.
INSERT INTO evidence_transfers (reason, evidence_id, from_user_id, to_user_id)
VALUES ('Handing to myself', 6, 4, 4);

-- F6. Reason too short
-- EXPECT: ERROR 3819 Check constraint 'chk_tr_reason' is violated.
INSERT INTO evidence_transfers (reason, evidence_id, from_user_id, to_user_id)
VALUES ('ok', 6, 4, 5);

-- F7. Hash tampering
-- EXPECT: ERROR 1644 (45000) file_hash is immutable: evidence tampering blocked
UPDATE evidence SET file_hash = SHA2('forged', 256) WHERE id = 1;

-- F8. Editing the audit log
-- EXPECT: ERROR 1644 (45000) audit_logs is append-only: UPDATE not allowed
UPDATE audit_logs SET action = 'LOGIN' WHERE id = 1;

-- F9. Deleting an audit row
-- EXPECT: ERROR 1644 (45000) audit_logs is append-only: DELETE not allowed
DELETE FROM audit_logs WHERE id = 1;

-- F10. Deleting evidence that has custody history (ON DELETE RESTRICT)
-- EXPECT: ERROR 1451 Cannot delete or update a parent row: a foreign key constraint fails
DELETE FROM evidence WHERE id = 1;

-- F11. Transfer by someone who is not the current custodian (user 7 does not hold #6)
-- EXPECT: ERROR 1644 (45000) from_user is not the current custodian of this evidence
CALL transfer_custody(6, 7, 5, 'Trying to hand over something I do not hold');

-- F12. Transfer to the same user
-- EXPECT: ERROR 1644 (45000) Cannot transfer evidence to the same user
CALL transfer_custody(6, 4, 4, 'Handing to myself');

-- F13. Transfer of a DESTROYED item (create one, then try)
INSERT INTO evidence (status, file_hash, file_name, evidence_type_id, collected_by, custodian_id)
VALUES ('DESTROYED', SHA2('destroyed-item', 256), 'destroyed.E01', 1, 4, 4);
-- EXPECT: ERROR 1644 (45000) Evidence is DESTROYED or RELEASED and cannot be transferred
CALL transfer_custody(LAST_INSERT_ID(), 4, 5, 'Should be refused');

-- F14. Transfer to an inactive user
UPDATE users SET is_active = FALSE WHERE id = 8;
-- EXPECT: ERROR 1644 (45000) Target user is inactive
CALL transfer_custody(6, 4, 8, 'Handing to a deactivated account');
UPDATE users SET is_active = TRUE WHERE id = 8;   -- restore

-- F15. Transfer of a non-existent item
-- EXPECT: ERROR 1644 (45000) Evidence not found
CALL transfer_custody(99999, 4, 5, 'No such evidence');

-- Proof that every failed CALL rolled back: custodian of #6 is still user 4.
-- EXPECT: custodian_id = 4, and 0 transfer rows for evidence 6
SELECT custodian_id FROM evidence WHERE id = 6;
SELECT COUNT(*) AS transfers_for_6 FROM evidence_transfers WHERE evidence_id = 6;

-- ======================= SHOULD SUCCEED =======================

-- S1. Valid evidence insert
-- EXPECT: Query OK, 1 row affected. The insert trigger writes an audit row with user_id = 2.
INSERT INTO evidence (file_hash, file_name, evidence_type_id, collected_by, custodian_id)
VALUES (SHA2('good-item', 256), 'good_item.E01', 1, 2, 2);
SET @new_id = LAST_INSERT_ID();

-- S2. Valid transfer through the procedure
-- EXPECT: Query OK. #new moves from user 2 to user 5.
CALL transfer_custody(@new_id, 2, 5, 'Handed to analyst for imaging');

-- S3. Chained transfer by the new custodian (acting user changes)
SET @app_user_id = 5;
CALL transfer_custody(@new_id, 5, 6, 'Second-opinion examination');

-- S4. Verify the result
-- EXPECT: custodian_name is user 6's name; transfer_seq 1 and 2 in the chain.
SELECT id, file_name, status, custodian_name FROM v_evidence_current WHERE id = @new_id;
SELECT transfer_seq, from_user, to_user, reason FROM v_chain_of_custody WHERE evidence_id = @new_id ORDER BY transfer_seq;

-- S5. Audit trail of that evidence
-- EXPECT (oldest first): INSERT(user 2), TRANSFER(2), UPDATE(2), TRANSFER(5), UPDATE(5)
-- (each transfer writes a TRANSFER row from the transfers trigger and an UPDATE row from the custodian change)
SELECT id, action, user_id, created_at FROM audit_logs
WHERE target_table = 'evidence' AND target_id = @new_id ORDER BY id;

-- S6. Legitimate edit of a non-protected column
-- EXPECT: Query OK, and an UPDATE audit row.
UPDATE evidence SET status = 'IN_ANALYSIS' WHERE id = @new_id;

-- S7. Deleting evidence that has NO custody history is allowed, and is audited as DELETE.
SET @app_user_id = 2;
INSERT INTO evidence (file_hash, file_name, evidence_type_id, collected_by, custodian_id)
VALUES (SHA2('temporary-item', 256), 'temp.E01', 1, 2, 2);
SET @temp_id = LAST_INSERT_ID();
DELETE FROM evidence WHERE id = @temp_id;
SELECT action, user_id FROM audit_logs WHERE target_table = 'evidence' AND target_id = @temp_id ORDER BY id;  -- INSERT, DELETE

-- S8. Seeded integrity check (Q6 in evidence_queries.sql) - EXPECT: 0 rows
SELECT e.id FROM evidence e
WHERE EXISTS (SELECT 1 FROM evidence_transfers x WHERE x.evidence_id = e.id)
  AND e.custodian_id <> (SELECT tr.to_user_id FROM evidence_transfers tr
                          WHERE tr.evidence_id = e.id ORDER BY tr.transferred_at DESC, tr.id DESC LIMIT 1);

-- ======================= TWO-SESSION LOCK DEMO =======================
-- Goal: prove SELECT ... FOR UPDATE stops two people transferring the same item.
-- Evidence #6 is held by user 4 (never transferred in the seed). Open TWO mysql terminals.
--
-- SESSION 1                                              SESSION 2
-- ---------                                              ---------
-- USE shadowtrace;                                       USE shadowtrace;
-- START TRANSACTION;
-- SELECT custodian_id FROM evidence
--   WHERE id = 6 FOR UPDATE;      -- returns 4; row locked
--                                                        CALL transfer_custody(6, 4, 7, 'Race attempt');
--                                                        -- HANGS here (waiting for the lock)
-- SELECT trx_state, trx_query FROM
--   information_schema.innodb_trx;  -- (optional) shows session 2 as LOCK WAIT
-- INSERT INTO evidence_transfers
--   (reason, evidence_id, from_user_id, to_user_id)
--   VALUES ('Session 1 wins', 6, 4, 5);
-- UPDATE evidence SET custodian_id = 5 WHERE id = 6;
-- COMMIT;                          -- lock released
--                                                        -- Session 2 now continues and FAILS with:
--                                                        -- ERROR 1644 (45000): from_user is not the current
--                                                        -- custodian of this evidence
--
-- Final check (either session): SELECT custodian_id FROM evidence WHERE id = 6;  -- 5
--                               SELECT COUNT(*) FROM evidence_transfers WHERE evidence_id = 6;  -- 1 (not 2)
-- If Session 1 waits longer than 50 s, Session 2 gets ERROR 1205 (lock wait timeout) instead - just retry quicker.
-- Run this demo LAST, because it changes who holds #6 (re-run `npm run db:reset` to repeat the earlier tests).
