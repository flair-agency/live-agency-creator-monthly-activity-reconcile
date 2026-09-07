import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileMonthlyActivity } from '../src/application.js';
import { buildPlan } from '../src/core.js';
import { normalizeSnapshot } from '../src/contracts.js';
import { buildPlan as legacyPlan, normalizeSnapshot as legacySnapshot } from '../scripts/lark_activity_sync.mjs';

const selection = { readBinding: 'read', writeBinding: 'write', targetBinding: 'target' };
const request = { month: '2030-01', accountKeys: ['creator.one', 'creator.two'] };
const snapshot = {
  month: request.month, sourceUpdatedAt: '2030-02-01T00:00:00Z', rowCount: 2,
  creators: request.accountKeys.map(accountKey => ({ accountKey, diamonds: 100, effectiveLiveDays: 2, liveMinutes: 90 })),
};
function fixture({ unknown = false, persist = true } = {}) {
  const records = snapshot.creators.map((row, index) => ({
    recordId: `record_${index}`, month: request.month, accountKey: row.accountKey,
    metrics: { diamonds: index ? 100 : 80, effectiveLiveDays: 2, liveMinutes: 90 },
  }));
  const state = { writes: 0, reads: 0 };
  const source = { readActivity: async () => structuredClone(snapshot) };
  const destination = {
    async readRecords() { state.reads++; return { selection, records: structuredClone(records) }; },
    async applyChanges({ changes }) {
      state.writes++;
      if (persist) for (const change of changes) records.find(row => row.recordId === change.recordId).metrics = change.desired;
      return { status: unknown ? 'unknown' : 'applied' };
    },
  };
  return { args: { request, source, destination, expectedSelection: selection }, state, records };
}
const approval = plan => ({ mode: 'apply', approvedPlan: plan, authorization: { approved: true, selection } });

test('same synthetic input has legacy plan, targets and metrics parity', async () => {
  const value = fixture();
  const result = await reconcileMonthlyActivity(value.args);
  const names = { month: 'month', account: 'account', diamonds: 'diamonds', effectiveLiveDays: 'days', liveMinutes: 'minutes' };
  const bindings = Object.fromEntries(Object.entries(names).map(([key, name]) => [key, { name }]));
  const records = value.records.map(row => ({ record_id: row.recordId, fields: {
    month: '2030/01/01', account: row.accountKey, diamonds: row.metrics.diamonds,
    days: row.metrics.effectiveLiveDays, minutes: row.metrics.liveMinutes,
  } }));
  const old = legacyPlan(records, legacySnapshot(snapshot), bindings);
  assert.deepEqual(result.rows, old.rows);
  assert.deepEqual(result.errors, old.errors);
  assert.deepEqual(result.plan.changes.map(row => row.recordId), old.updates.map(row => row.record_id));
  assert.equal(result.changeCount, 1);
  assert.equal(value.state.writes, 0);
});

test('explicit approval and fresh identical plan are required before writing', async () => {
  const value = fixture();
  const dry = await reconcileMonthlyActivity(value.args);
  await assert.rejects(reconcileMonthlyActivity({ ...value.args, mode: 'apply' }), /reviewed/);
  value.records[0].metrics.diamonds = 70;
  await assert.rejects(reconcileMonthlyActivity({ ...value.args, ...approval(dry.plan) }), /reviewed/);
  assert.equal(value.state.writes, 0);
});

test('selection mismatch and wrong source account scope stop before writing', async () => {
  const value = fixture();
  await assert.rejects(reconcileMonthlyActivity({ ...value.args, expectedSelection: { ...selection, targetBinding: 'wrong' } }), /selection/);
  value.args.source.readActivity = async () => ({ ...snapshot, creators: [{ ...snapshot.creators[0], accountKey: 'unexpected' }, snapshot.creators[1]] });
  await assert.rejects(reconcileMonthlyActivity(value.args), /scope/);
  assert.equal(value.state.writes, 0);
});

test('uncertain write is reconciled once by readback, never resent', async () => {
  for (const persist of [true, false]) {
    const value = fixture({ unknown: true, persist });
    const dry = await reconcileMonthlyActivity(value.args);
    const result = await reconcileMonthlyActivity({ ...value.args, ...approval(dry.plan) });
    assert.equal(result.verified, persist);
    assert.equal(result.status, persist ? 'done' : 'failed');
    assert.equal(value.state.writes, 1);
    assert.equal(value.state.reads, 3);
  }
});

test('missing and ambiguous matches preserve legacy stop reasons', () => {
  for (const records of [[], [{ recordId: 'one', month: request.month, accountKey: request.accountKeys[0] }, { recordId: 'two', month: request.month, accountKey: request.accountKeys[0] }]]) {
    const plan = buildPlan({ request, snapshot, records, selection });
    assert.equal(plan.errors.length, 2);
    assert.match(plan.errors[0], records.length ? /multiple destination records/ : /no destination record/);
  }
});

test('contract rejects normalized duplicates, excessive live days and invalid timestamps', () => {
  assert.throws(() => normalizeSnapshot({ ...snapshot, creators: [snapshot.creators[0], { ...snapshot.creators[1], accountKey: '@CREATOR.ONE' }] }), /duplicated/);
  assert.throws(() => normalizeSnapshot({ ...snapshot, creators: [{ ...snapshot.creators[0], effectiveLiveDays: 32 }, snapshot.creators[1]] }), /exceeds/);
  assert.throws(() => normalizeSnapshot({ ...snapshot, sourceUpdatedAt: '2030-02-30T00:00:00Z' }), /date-time/);
});

test('instruction source yields without destination access', async () => {
  const value = fixture();
  const pending = { status: 'interaction-required', requestId: 'synthetic-request', capability: 'creator-activity-source', version: 1, context: request };
  value.args.source.readActivity = async () => pending;
  assert.deepEqual(await reconcileMonthlyActivity(value.args), pending);
  assert.equal(value.state.reads, 0);
});

test('provider response extras cannot replace the requested source snapshot or account scope', async () => {
  const value = fixture();
  const read = value.args.destination.readRecords;
  value.args.destination.readRecords = async () => ({
    ...await read(), request: { month: '2040-01', accountKeys: ['injected'] },
    snapshot: { ...snapshot, month: '2040-01' },
  });
  const result = await reconcileMonthlyActivity(value.args);
  assert.equal(result.month, request.month);
  assert.deepEqual(result.plan.request, request);
});

test('a matching readback cannot substitute the reviewed record identity', async () => {
  const value = fixture();
  const dry = await reconcileMonthlyActivity(value.args);
  const write = value.args.destination.applyChanges;
  value.args.destination.applyChanges = async args => {
    const result = await write(args);
    value.records[0].recordId = 'replacement';
    return result;
  };
  const result = await reconcileMonthlyActivity({ ...value.args, ...approval(dry.plan) });
  assert.equal(result.status, 'failed');
  assert.equal(result.verified, false);
  assert.equal(value.state.writes, 1);
});
