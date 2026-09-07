import { validateRecordResult, validateApplyOutcome } from '@flair-agency/contracts/monthly-activity';
import {
  validateRequest,
  assertSelection,
  canonical,
  validateChanges,
} from './contracts.js';
import { buildPlan, summarize } from './core.js';

function recordIdentities(plan) {
  return plan.rows.map(({ accountKey, recordId }) => ({ accountKey, recordId }))
    .sort((left, right) => left.accountKey.localeCompare(right.accountKey));
}

export async function reconcileMonthlyActivity({
  request: rawRequest,
  source,
  destination,
  expectedSelection,
  mode = 'dry-run',
  approvedPlan,
  authorization,
}) {
  const request = validateRequest(rawRequest);
  if (!['dry-run', 'apply'].includes(mode)) {
    throw new TypeError('unsupported reconciliation mode');
  }
  assertSelection(expectedSelection, expectedSelection, mode === 'apply');
  if (typeof source?.readActivity !== 'function'
      || typeof destination?.readRecords !== 'function'
      || typeof destination?.applyChanges !== 'function') {
    throw new TypeError('explicit source and destination operations are required');
  }
  const snapshot = await source.readActivity(request);
  if (snapshot?.status === 'interaction-required') return snapshot;

  const initial = validateRecordResult(await destination.readRecords(request));
  assertSelection(initial.selection, expectedSelection, mode === 'apply');
  const plan = buildPlan({ request, snapshot, records: initial.records, selection: initial.selection });
  if (plan.errors.length) {
    return { status: 'failed', ...summarize(plan, 'dry-run'), plan };
  }
  if (mode === 'dry-run') {
    return { status: 'done', ...summarize(plan, mode), plan };
  }

  validateChanges(plan.changes);
  if (authorization?.approved !== true || canonical(approvedPlan) !== canonical(plan)) {
    throw new TypeError('apply requires the unchanged reviewed dry-run plan and explicit authorization');
  }
  assertSelection(authorization.selection, expectedSelection, true);
  let outcome = { status: 'applied' };
  if (plan.changes.length) {
    try {
      outcome = await destination.applyChanges({
        request, changes: plan.changes, selection: expectedSelection, authorization,
      });
    } catch (error) {
      if (error?.uncertainWrite !== true) throw error;
      outcome = { status: 'unknown' };
    }
  }
  validateApplyOutcome(outcome);
  if (['conflict', 'rejected'].includes(outcome.status)) {
    return { status: 'failed', ...summarize(plan, mode), writeOutcome: outcome.status, plan };
  }

  const readback = validateRecordResult(await destination.readRecords(request));
  assertSelection(readback.selection, expectedSelection, true);
  const verified = buildPlan({ request, snapshot, records: readback.records, selection: readback.selection });
  if (verified.errors.length || verified.changes.length
      || canonical(recordIdentities(verified)) !== canonical(recordIdentities(plan))) {
    return {
      status: 'failed',
      ...summarize(verified, mode),
      writeOutcome: outcome.status,
      error: 'readback does not prove the requested metrics; do not retry automatically',
      plan,
    };
  }
  return {
    status: 'done',
    ...summarize(verified, mode, true),
    writeOutcome: outcome.status === 'unknown' ? 'reconciled-after-uncertain-response' : 'confirmed',
    plan,
  };
}
