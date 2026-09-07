import {
  normalizeSnapshot,
  normalizeAccountKey,
  validateRequest,
  validateSelection,
  validateMetrics,
  canonical,
} from './contracts.js';

export function buildPlan({ request: rawRequest, snapshot: rawSnapshot, records, selection }) {
  const request = validateRequest(rawRequest);
  const snapshot = normalizeSnapshot(rawSnapshot, request.month);
  validateSelection(selection);
  const sourceAccounts = snapshot.creators.map(row => row.accountKey).sort();
  if (canonical(sourceAccounts) !== canonical([...request.accountKeys].sort())) {
    throw new TypeError('activity account scope does not match request');
  }
  if (!Array.isArray(records)) throw new TypeError('destination records must be an array');
  const rows = [], changes = [], errors = [];
  for (const creator of snapshot.creators) {
    const matches = records.filter(row => row.month === request.month
      && normalizeAccountKey(row.accountKey) === creator.accountKey);
    if (!matches.length) {
      errors.push(`${creator.accountKey}: no destination record in ${snapshot.month}`);
      continue;
    }
    if (matches.length > 1) {
      errors.push(`${creator.accountKey}: multiple destination records (${matches.map(row => row.recordId).join(', ')})`);
      continue;
    }
    const record = matches[0];
    if (typeof record.recordId !== 'string' || !record.recordId) {
      errors.push(`${creator.accountKey}: destination record ID is missing`);
      continue;
    }
    validateMetrics(record.metrics, true);
    const current = { ...record.metrics };
    const desired = {
      diamonds: creator.diamonds,
      effectiveLiveDays: creator.effectiveLiveDays,
      liveMinutes: creator.liveMinutes,
    };
    const changed = canonical(current) !== canonical(desired);
    const row = {
      accountKey: creator.accountKey,
      recordId: record.recordId,
      status: changed ? 'change' : 'unchanged',
      current,
      desired,
    };
    rows.push(row);
    if (changed) changes.push({ accountKey: row.accountKey, recordId: row.recordId, current, desired });
  }
  if (new Set(rows.map(row => row.recordId)).size !== rows.length) {
    errors.push('destination record matches multiple source accounts');
  }
  return { request, snapshot, selection: structuredClone(selection), rows, changes, errors };
}

export function summarize(plan, mode, verified = false) {
  return {
    mode,
    month: plan.snapshot.month,
    sourceUpdatedAt: plan.snapshot.sourceUpdatedAt,
    sourceCreatorCount: plan.snapshot.rowCount,
    matchedCount: plan.rows.length,
    changeCount: plan.changes.length,
    unchangedCount: plan.rows.filter(row => row.status === 'unchanged').length,
    verified,
    errors: plan.errors,
    rows: plan.rows,
  };
}
