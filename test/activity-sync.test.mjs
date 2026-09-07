import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ReconciliationError,
  SyncError,
  VerificationError,
  buildPlan,
  normalizeSnapshot,
  resolveFields,
  runSync,
} from "../scripts/lark_activity_sync.mjs";
import { resolveActivitySource } from "../scripts/resolve_activity_source.mjs";
import { toCreatorActivitySyncInput } from "../scripts/management_activity_input.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../../../test/fixtures/installation");
const accountKeysSha256 = (accountKeys) => createHash("sha256")
  .update(JSON.stringify(accountKeys))
  .digest("hex");

const fieldIds = {
  month: "fld_month",
  account: "fld_account",
  diamonds: "fld_diamonds",
  effectiveLiveDays: "fld_days",
  liveMinutes: "fld_minutes",
};

function fields(prefix = "") {
  return [
    { field_id: fieldIds.month, field_name: `${prefix}month`, type: 20 },
    { field_id: fieldIds.account, field_name: `${prefix}account`, type: 20 },
    { field_id: fieldIds.diamonds, field_name: `${prefix}diamonds`, type: 2 },
    { field_id: fieldIds.effectiveLiveDays, field_name: `${prefix}days`, type: 2 },
    { field_id: fieldIds.liveMinutes, field_name: `${prefix}minutes`, type: 2 },
  ];
}

function snapshot() {
  return normalizeSnapshot({
    month: "2030-01",
    sourceUpdatedAt: "2030-01-02T03:04:05.000Z",
    rowCount: 1,
    creators: [
      { accountKey: "@Synthetic.Creator", diamonds: 100, effectiveLiveDays: 2, liveMinutes: 90 },
    ],
  });
}

function destinationConfig() {
  return { appToken: "base_activity", tableId: "table_activity", fieldIds };
}

function selectedProviderFixture({
  tokenType = "user",
  includeWrite = false,
  uncertainWrite = false,
  preserveOldValues = false,
  mutateProvider,
} = {}) {
  const state = {
    requests: [],
    writeAttempts: 0,
    current: {
      record_id: "rec_activity",
      fields: {
        month: "2030/01/01",
        account: "synthetic.creator",
        diamonds: 80,
        days: 1,
        minutes: 60,
      },
    },
  };
  const provider = {
    contractVersion: "creator-activity-selected-provider/v1",
    tokenType,
    organizationProfileId: "org_activity",
    principalProfileId: `${tokenType}_activity_actor`,
    readSelectionBindingSha256: "a".repeat(64),
    writeSelectionBindingSha256: includeWrite ? "b".repeat(64) : null,
    fieldTableBinding: {
      contractVersion: "creator-activity-lark-binding/v1",
      baseToken: "base_activity",
      tableId: "table_activity",
      fieldIds,
      bindingSha256: "c".repeat(64),
    },
    writeEnabled: includeWrite,
    async listFields() {
      state.requests.push({ url: "synthetic://fields", method: "GET" });
      return fields();
    },
    async searchRecords() {
      state.requests.push({ url: "synthetic://records/search", method: "POST", body: JSON.stringify({ page_size: 500 }) });
      return [structuredClone(state.current)];
    },
    async batchUpdate(records) {
      state.requests.push({ url: "synthetic://records/batch_update", method: "POST", body: JSON.stringify({ records }) });
      state.writeAttempts += 1;
      if (!preserveOldValues) Object.assign(state.current.fields, records[0].fields);
      if (uncertainWrite) {
        const error = new Error("synthetic uncertain response");
        error.uncertainWrite = true;
        throw error;
      }
      return records;
    },
  };
  mutateProvider?.(provider);
  return { providerFactory: () => provider, providerInput: Object.freeze({ synthetic: true }), state };
}

const runSelected = (fixture, options = {}) => runSync({
  snapshot: snapshot(),
  config: destinationConfig(),
  providerFactory: fixture.providerFactory,
  providerInput: fixture.providerInput,
  ...options,
});

test("normalizes identity and rejects post-normalization duplicates", () => {
  assert.equal(snapshot().creators[0].accountKey, "synthetic.creator");
  assert.throws(
    () =>
      normalizeSnapshot({
        month: "2030-01",
        sourceUpdatedAt: "2030-01-02T03:04:05.000Z",
        rowCount: 2,
        creators: [
          { accountKey: "Same", diamonds: 1, effectiveLiveDays: 1, liveMinutes: 1 },
          { accountKey: "@same", diamonds: 2, effectiveLiveDays: 2, liveMinutes: 2 },
        ],
      }),
    /duplicated after normalization/,
  );
});

test("resolves renamed fields strictly by stable IDs", () => {
  const bindings = resolveFields(fields("renamed_"), fieldIds);
  const plan = buildPlan(
    [
      {
        record_id: "rec1",
        fields: {
          renamed_month: "2030/01/01",
          renamed_account: [{ text: "synthetic.creator" }],
          renamed_diamonds: 80,
          renamed_days: 1,
          renamed_minutes: 60,
        },
      },
    ],
    snapshot(),
    bindings,
  );
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.updates[0].fields, {
    renamed_diamonds: 100,
    renamed_days: 2,
    renamed_minutes: 90,
  });
});

test("rejects a duplicate monthly destination match", () => {
  const bindings = resolveFields(fields(), fieldIds);
  const record = {
    fields: { month: "2030/01/01", account: "synthetic.creator" },
  };
  const plan = buildPlan(
    [
      { ...record, record_id: "rec1" },
      { ...record, record_id: "rec2" },
    ],
    snapshot(),
    bindings,
  );
  assert.equal(plan.updates.length, 0);
  assert.match(plan.errors[0], /multiple destination records/);
});

test("requires numeric metric destinations", () => {
  const wrong = fields();
  wrong.find((field) => field.field_id === fieldIds.liveMinutes).type = 20;
  assert.throws(() => resolveFields(wrong, fieldIds), ReconciliationError);
});

test("applies only the three metric fields and verifies by rereading", async () => {
  const fixture = selectedProviderFixture({ includeWrite: true });
  const result = await runSelected(fixture, { apply: true });
  assert.equal(result.verified, true);
  assert.equal(result.writeOutcome, "confirmed");
  assert.equal(fixture.state.writeAttempts, 1);
  const write = fixture.state.requests.find((request) => request.url.endsWith("/records/batch_update"));
  assert.deepEqual(Object.keys(JSON.parse(write.body).records[0].fields).sort(), ["days", "diamonds", "minutes"]);
});

test("requires factory injection and never falls back to environment credentials", async () => {
  const names = ["LARK_TENANT_ACCESS_TOKEN", "LARK_APP_ID", "LARK_APP_SECRET"];
  const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.LARK_TENANT_ACCESS_TOKEN = "must-not-be-read";
  process.env.LARK_APP_ID = "must-not-be-read";
  process.env.LARK_APP_SECRET = "must-not-be-read";
  try {
    await assert.rejects(
      runSync({ snapshot: snapshot(), config: destinationConfig() }),
      (error) => error instanceof SyncError && /injected Lark Base selected-provider factory/.test(error.message),
    );
  } finally {
    for (const name of names) {
      if (before[name] === undefined) delete process.env[name];
      else process.env[name] = before[name];
    }
  }
});

test("selected Provider supports explicit verified User and Tenant reads through records:search", async () => {
  for (const tokenType of ["user", "tenant"]) {
    const fixture = selectedProviderFixture({ tokenType });
    const result = await runSelected(fixture);
    assert.equal(result.mode, "dry-run");
    assert.equal(fixture.state.writeAttempts, 0);
    const search = fixture.state.requests.find((request) => request.url.endsWith("/records/search"));
    assert.equal(search.method, "POST");
    assert.equal(JSON.parse(search.body).page_size, 500);
    assert.equal(fixture.state.requests.some((request) => /\/records(?:\?|$)/.test(request.url)), false);
  }
});

test("rejects a selected Provider whose immutable destination binding differs before protected access", async () => {
  const mismatchedConfig = selectedProviderFixture();
  await assert.rejects(runSync({
    snapshot: snapshot(),
    config: { ...destinationConfig(), tableId: "another_table" },
    providerFactory: mismatchedConfig.providerFactory,
    providerInput: mismatchedConfig.providerInput,
  }), /immutable destination binding/);
  assert.equal(mismatchedConfig.state.requests.length, 0);
});

test("preserves dry-run semantics even when a reviewed write contract is available", async () => {
  const fixture = selectedProviderFixture({ includeWrite: true });
  const result = await runSelected(fixture);
  assert.equal(result.mode, "dry-run");
  assert.equal(result.verified, false);
  assert.equal(fixture.state.writeAttempts, 0);
});

test("apply fails closed before protected access without the separately explicit write contract", async () => {
  const fixture = selectedProviderFixture();
  await assert.rejects(
    runSelected(fixture, { apply: true }),
    (error) => error instanceof SyncError && /reviewed batch-update operation contract/.test(error.message),
  );
  assert.equal(fixture.state.requests.length, 0);
});

test("an uncertain write is read back once and is never automatically retried", async () => {
  const fixture = selectedProviderFixture({ includeWrite: true, uncertainWrite: true });
  const result = await runSelected(fixture, { apply: true });
  assert.equal(result.verified, true);
  assert.equal(result.writeOutcome, "reconciled-after-uncertain-response");
  assert.equal(fixture.state.writeAttempts, 1);
  assert.equal(fixture.state.requests.filter((request) => request.url.endsWith("/records/search")).length, 2);
});

test("post-write readback stops when requested metrics are not proven", async () => {
  const fixture = selectedProviderFixture({ includeWrite: true, preserveOldValues: true });
  await assert.rejects(
    runSelected(fixture, { apply: true }),
    (error) => error instanceof VerificationError && /post-write reread/.test(error.message),
  );
  assert.equal(fixture.state.writeAttempts, 1);
});

test("uncertain-write readback stops without retry when requested metrics are not proven", async () => {
  const fixture = selectedProviderFixture({
    includeWrite: true,
    uncertainWrite: true,
    preserveOldValues: true,
  });
  await assert.rejects(
    runSelected(fixture, { apply: true }),
    (error) => error instanceof VerificationError && /uncertain write readback/.test(error.message),
  );
  assert.equal(fixture.state.writeAttempts, 1);
});

test("resolves a raw request through npm and writes a normalized private output", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "activity-source-test-"));
  try {
    const requestPath = path.join(directory, "request.json");
    const outputPath = path.join(directory, "normalized.json");
    await writeFile(
      requestPath,
      JSON.stringify({
        inputKind: "text/markdown",
        month: "2030-01",
        sourceUpdatedAt: "2030-01-02T03:04:05.000Z",
        text: "synthetic input",
      }),
      { encoding: "utf8", mode: 0o600 },
    );
    const result = await resolveActivitySource({
      providerRoot: repositoryRoot,
      request: requestPath,
      output: outputPath,
      unattended: false,
    });
    const output = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(result.snapshot.rowCount, 1);
    assert.equal(output.creators[0].accountKey, "synthetic_creator");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("converts a validated Creator Management observation into the activity-sync input contract", () => {
  const input = toCreatorActivitySyncInput({
    status: "validated",
    request: {
      version: 1,
      month: "2030-01",
      targetMode: "selected",
      accountKeys: ["@Synthetic.Creator"],
      generatedAt: "2030-02-01T00:00:00.000Z",
      accountKeysSha256: accountKeysSha256(["synthetic.creator"]),
    },
    sourceContext: {
      capability: "creator-activity-source/v1",
      providerPackage: "@synthetic/activity-provider",
      providerVersion: "1.0.0",
      bindingId: "monthly-activity",
      knowledgeVersion: "synthetic/1",
    },
    snapshot: {
      month: "2030-01",
      sourceUpdatedAt: "2030-02-01T00:05:00.000Z",
      rowCount: 1,
      creators: [{
        accountKey: " @SYNTHETIC.CREATOR ",
        diamonds: 1200,
        effectiveLiveDays: 8,
        liveMinutes: 945,
      }],
    },
  });

  assert.deepEqual(input, {
    month: "2030-01",
    sourceUpdatedAt: "2030-02-01T00:05:00.000Z",
    rowCount: 1,
    creators: [{
      accountKey: "synthetic.creator",
      diamonds: 1200,
      effectiveLiveDays: 8,
      liveMinutes: 945,
    }],
  });
});

test("rejects unvalidated, malformed, or scope-drifting Management activity observations", () => {
  const base = {
    status: "validated",
    request: {
      version: 1,
      month: "2030-01",
      targetMode: "selected",
      accountKeys: ["synthetic.creator"],
      generatedAt: "2030-02-01T00:00:00.000Z",
      accountKeysSha256: accountKeysSha256(["synthetic.creator"]),
    },
    sourceContext: {
      capability: "creator-activity-source/v1",
      providerPackage: "@synthetic/activity-provider",
      providerVersion: "1.0.0",
      bindingId: "monthly-activity",
    },
    snapshot: {
      month: "2030-01",
      sourceUpdatedAt: "2030-02-01T00:05:00.000Z",
      rowCount: 1,
      creators: [{
        accountKey: "synthetic.creator",
        diamonds: 1200,
        effectiveLiveDays: 8,
        liveMinutes: 945,
      }],
    },
  };

  assert.throws(
    () => toCreatorActivitySyncInput({ ...base, status: "completed" }),
    /must be validated/,
  );
  assert.throws(
    () => toCreatorActivitySyncInput({
      ...base,
      snapshot: {
        ...base.snapshot,
        creators: [{ ...base.snapshot.creators[0], accountKey: "unrequested.creator" }],
      },
    }),
    /does not match the selected account scope/,
  );
  assert.throws(
    () => toCreatorActivitySyncInput({
      ...base,
      snapshot: {
        ...base.snapshot,
        creators: [{ ...base.snapshot.creators[0], effectiveLiveDays: 32 }],
      },
    }),
    /exceeds the number of days/,
  );
  assert.throws(
    () => toCreatorActivitySyncInput({
      ...base,
      request: { ...base.request, accountKeysSha256: "a".repeat(64) },
    }),
    /accountKeysSha256 does not match/,
  );
});
