-- evidence_queries.sql (Member A): reference SELECTs for the evidence module.
-- Not run by `npm run db:init` (that only runs db/sql/). Paste into a MySQL client, or copy into route handlers.
-- In the app, replace literal values with "?" placeholders.
USE shadowtrace;

-- Q1. JOIN + ORDER BY: current custody list (the main evidence table in the UI)
-- Shows: INNER JOIN across 4 tables; users joined twice with aliases (collector vs custodian).
SELECT e.id, e.file_name, e.status, t.type_name,
       c.full_name AS collected_by, h.full_name AS current_custodian, e.collected_at
FROM evidence e
JOIN evidence_types t ON t.id = e.evidence_type_id
JOIN users c ON c.id = e.collected_by
JOIN users h ON h.id = e.custodian_id
ORDER BY e.collected_at DESC;

-- Q2. GROUP BY + HAVING: custodians holding more than 3 items
-- Shows: HAVING filters AFTER grouping (WHERE cannot use COUNT).
SELECT u.id, u.full_name, COUNT(*) AS items_held
FROM evidence e
JOIN users u ON u.id = e.custodian_id
GROUP BY u.id, u.full_name
HAVING COUNT(*) > 3
ORDER BY items_held DESC;

-- Q3. LEFT JOIN ... IS NULL: evidence that has never been transferred
-- Shows: anti-join. Evidence with no matching transfer row survives the LEFT JOIN with NULLs.
SELECT e.id, e.file_name, e.status, u.full_name AS still_with_collector
FROM evidence e
LEFT JOIN evidence_transfers tr ON tr.evidence_id = e.id
JOIN users u ON u.id = e.custodian_id
WHERE tr.id IS NULL
ORDER BY e.id;

-- Q4. Aggregate + ORDER BY + LIMIT: top 5 most-transferred evidence
SELECT e.id, e.file_name, COUNT(tr.id) AS transfer_count, MAX(tr.transferred_at) AS last_transfer
FROM evidence e
JOIN evidence_transfers tr ON tr.evidence_id = e.id
GROUP BY e.id, e.file_name
ORDER BY transfer_count DESC, last_transfer DESC
LIMIT 5;

-- Q5. CTE + window function: average hours between custody events, per evidence type
-- LAG() looks at the previous transfer of the SAME evidence (PARTITION BY evidence_id).
-- For the first transfer there is no previous one, so the default is collected_at.
WITH gaps AS (
  SELECT e.evidence_type_id,
         TIMESTAMPDIFF(HOUR,
           LAG(tr.transferred_at, 1, e.collected_at) OVER (PARTITION BY tr.evidence_id ORDER BY tr.transferred_at),
           tr.transferred_at) AS hours_gap
  FROM evidence_transfers tr
  JOIN evidence e ON e.id = tr.evidence_id
)
SELECT t.type_name, COUNT(*) AS transfers, ROUND(AVG(g.hours_gap), 1) AS avg_hours_between
FROM gaps g
JOIN evidence_types t ON t.id = g.evidence_type_id
GROUP BY t.id, t.type_name
ORDER BY avg_hours_between DESC;

-- Q6. CORRELATED SUBQUERY: integrity check - custodian must equal the recipient of the latest transfer
-- The inner query runs once per evidence row (it refers to e.id). Expected result: 0 rows.
-- Evidence that was never transferred is skipped (no transfer to compare with).
SELECT e.id, e.file_name, e.custodian_id AS recorded_custodian,
       (SELECT tr.to_user_id FROM evidence_transfers tr
         WHERE tr.evidence_id = e.id
         ORDER BY tr.transferred_at DESC, tr.id DESC LIMIT 1) AS latest_recipient
FROM evidence e
WHERE EXISTS (SELECT 1 FROM evidence_transfers x WHERE x.evidence_id = e.id)
  AND e.custodian_id <> (SELECT tr.to_user_id FROM evidence_transfers tr
                          WHERE tr.evidence_id = e.id
                          ORDER BY tr.transferred_at DESC, tr.id DESC LIMIT 1);

-- Q7. Conditional aggregation: status breakdown per evidence type (dashboard table)
SELECT t.type_name,
       COUNT(e.id)                         AS total,
       SUM(e.status = 'COLLECTED')         AS collected,
       SUM(e.status = 'IN_ANALYSIS')       AS in_analysis,
       SUM(e.status = 'IN_STORAGE')        AS in_storage,
       SUM(e.status IN ('RELEASED','DESTROYED')) AS closed_out
FROM evidence_types t
LEFT JOIN evidence e ON e.evidence_type_id = t.id   -- LEFT so types with no evidence still show 0
GROUP BY t.id, t.type_name
ORDER BY total DESC;

-- Q8. Two subqueries in SELECT: custody traffic per user (sent vs received)
-- Users who have handled evidence at all are kept by the HAVING-style WHERE on the derived columns.
SELECT * FROM (
  SELECT u.id, u.full_name,
         (SELECT COUNT(*) FROM evidence_transfers WHERE from_user_id = u.id) AS sent,
         (SELECT COUNT(*) FROM evidence_transfers WHERE to_user_id   = u.id) AS received
  FROM users u
) activity
WHERE sent + received > 0
ORDER BY sent + received DESC;
