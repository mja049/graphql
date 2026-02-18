/**
 * projectsPF.js
 * Pure functions for computing project pass/fail metrics.
 *
 * Input shape for each row (all fields optional / may be null):
 *   { grade, createdAt, updatedAt, path, objectId, object: { id, type } }
 */

/**
 * Pick a stable deduplication key for a row.
 * Prefer objectId (or object.id), fall back to path.
 */
function projectKey(row) {
  const id =
    row?.objectId ??
    row?.object?.id ??
    null;
  if (id !== null && id !== undefined && String(id).trim() !== "")
    return String(id);
  return String(row?.path ?? "__unknown__");
}

/**
 * Return a sortable timestamp string for a row.
 * Prefers updatedAt, falls back to createdAt, then empty string (sorts first/oldest).
 */
function rowTimestamp(row) {
  return String(row?.updatedAt ?? row?.createdAt ?? "");
}

/**
 * Guard: is the grade a valid, finite number?
 */
function validGrade(grade) {
  const n = Number(grade);
  return Number.isFinite(n) && grade !== null && grade !== undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * computeCurrentProjectsPF(rows)
 *
 * Deduplicates rows by project key (latest attempt per project),
 * then counts pass (grade > 0) and fail (grade === 0).
 *
 * @param {Array} rows  - result / progress rows
 * @returns {{ pass: number, fail: number, total: number }}
 */
export function computeCurrentProjectsPF(rows) {
  if (!Array.isArray(rows)) return { pass: 0, fail: 0, total: 0 };

  // Sort descending by timestamp so the first occurrence per key is the latest.
  const sorted = [...rows].sort((a, b) => {
    const ta = rowTimestamp(a);
    const tb = rowTimestamp(b);
    if (tb > ta) return 1;
    if (tb < ta) return -1;
    return 0;
  });

  // Keep only the latest row per project key.
  const seen = new Map(); // key -> row
  for (const row of sorted) {
    const key = projectKey(row);
    if (!seen.has(key)) seen.set(key, row);
  }

  let pass = 0;
  let fail = 0;

  for (const row of seen.values()) {
    const grade = row?.grade;
    if (!validGrade(grade)) continue;
    const n = Number(grade);
    if (n > 0) pass += 1;
    else fail += 1;           // grade === 0 (or negative, treated as fail)
  }

  return { pass, fail, total: pass + fail };
}

/**
 * computeAttemptsPF(rows)
 *
 * Counts every row independently (no deduplication).
 * success = count(grade > 0), fail = count(grade === 0 or grade < 0).
 *
 * @param {Array} rows  - result / progress rows
 * @returns {{ success: number, fail: number, total: number }}
 */
export function computeAttemptsPF(rows) {
  if (!Array.isArray(rows)) return { success: 0, fail: 0, total: 0 };

  let success = 0;
  let fail = 0;

  for (const row of rows) {
    const grade = row?.grade;
    if (!validGrade(grade)) continue;
    const n = Number(grade);
    if (n > 0) success += 1;
    else fail += 1;
  }

  return { success, fail, total: success + fail };
}
