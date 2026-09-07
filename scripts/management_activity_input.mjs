import {
  normalizeAccountKey,
  normalizeSnapshot,
} from "./lark_activity_sync.mjs";
import { createHash } from "node:crypto";

const ACTIVITY_CAPABILITY = "creator-activity-source/v1";

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function validatedRequest(value) {
  assertObject(value, "Creator Management activity request");
  if (
    value.version !== 1 ||
    !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value.month) ||
    !["complete", "selected"].includes(value.targetMode) ||
    !Array.isArray(value.accountKeys)
  ) {
    throw new TypeError("Creator Management activity request is invalid");
  }
  const accountKeys = value.accountKeys.map((accountKey, index) => {
    if (typeof accountKey !== "string") {
      throw new TypeError(`Creator Management activity request accountKeys[${index}] is invalid`);
    }
    const normalized = normalizeAccountKey(accountKey);
    if (!normalized) {
      throw new TypeError(`Creator Management activity request accountKeys[${index}] is invalid`);
    }
    return normalized;
  });
  if (new Set(accountKeys).size !== accountKeys.length) {
    throw new TypeError("Creator Management activity request accountKeys are duplicated");
  }
  if (value.targetMode === "complete" && accountKeys.length !== 0) {
    throw new TypeError("complete Creator Management activity request must not specify accountKeys");
  }
  if (value.targetMode === "selected" && accountKeys.length === 0) {
    throw new TypeError("selected Creator Management activity request requires accountKeys");
  }
  if (
    typeof value.generatedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value.generatedAt) ||
    Number.isNaN(Date.parse(value.generatedAt))
  ) {
    throw new TypeError("Creator Management activity request generatedAt is invalid");
  }
  const accountKeysSha256 = createHash("sha256").update(JSON.stringify(accountKeys)).digest("hex");
  if (value.accountKeysSha256 !== accountKeysSha256) {
    throw new TypeError("Creator Management activity request accountKeysSha256 does not match accountKeys");
  }
  return { month: value.month, targetMode: value.targetMode, accountKeys };
}

function assertSourceContext(value) {
  assertObject(value, "Creator Management activity sourceContext");
  if (value.capability !== ACTIVITY_CAPABILITY) {
    throw new TypeError(`Creator Management activity sourceContext.capability must be ${ACTIVITY_CAPABILITY}`);
  }
  for (const key of ["providerPackage", "providerVersion", "bindingId"]) {
    if (typeof value[key] !== "string" || !value[key].trim()) {
      throw new TypeError(`Creator Management activity sourceContext.${key} is required`);
    }
  }
}

// Converts only a completed, validated Creator Management observation to the
// existing source-neutral creator-activity-sync input. It performs no I/O and
// deliberately drops provenance because the sync input contract is snapshot-only.
export function toCreatorActivitySyncInput(value) {
  assertObject(value, "Creator Management activity validation result");
  if (value.status !== "validated") {
    throw new TypeError("Creator Management activity observation must be validated");
  }
  const request = validatedRequest(value.request);
  assertSourceContext(value.sourceContext);
  const snapshot = normalizeSnapshot(value.snapshot, request.month);

  if (request.targetMode === "selected") {
    const observed = new Set(snapshot.creators.map((creator) => creator.accountKey));
    const missing = request.accountKeys.filter((accountKey) => !observed.has(accountKey));
    const extras = [...observed].filter((accountKey) => !request.accountKeys.includes(accountKey));
    if (missing.length > 0 || extras.length > 0) {
      throw new TypeError("Creator Management activity snapshot does not match the selected account scope");
    }
  }
  return snapshot;
}
