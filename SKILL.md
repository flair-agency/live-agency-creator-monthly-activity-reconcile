---
name: creator-activity-sync
description: Validate normalized monthly creator activity metrics and safely reconcile diamonds, effective live days, and live minutes into an existing Lark Base table. Use for dry runs or approved updates; do not use to acquire service-specific source data or create records.
---

# Sync creator activity metrics

Reconcile a complete normalized monthly snapshot into existing Lark Base records.
The input source is pluggable; this skill does not know source-service URLs,
screens, export columns, or provider package names.

For every Lark Base read or mutation, follow the policy supplied by the
installed Lark Base provider.
This skill's field, authorization, and verification restrictions remain
mandatory.

## Input routing

Accept either:

1. a normalized JSON snapshot conforming to
   [references/normalized-activity-schema.md](references/normalized-activity-schema.md); or
2. raw user input plus a local npm composition root containing exactly one
   compatible `creator-activity-source/v1` provider for that input kind.

For raw input, run `scripts/resolve_activity_source.mjs`. Provider discovery is
limited to direct npm dependencies of the composition root. Do not guess a
provider, add provider IDs to this skill, or choose arbitrarily when resolution
returns zero or multiple matches.

For a scheduled or otherwise unattended run, pass `--unattended`. Continue only
when the provider manifest explicitly permits unattended execution. Pasted
prompt input is interactive.

## Destination configuration

Require a private local configuration file described in
[references/lark-config.md](references/lark-config.md). It must identify the Base,
table, and five fields by stable IDs. Resolve current field names from those IDs
at runtime because the record API uses names at its boundary. Never use a
display name as configuration or as a field identity.

Select the execution route before reconciliation. For the v2 route, read
[references/lark-config.md](references/lark-config.md#v2-selected-runtime) and use
the composition runtime's injected selected Provider. Missing selection stops
that route; environment credentials or browser/import operations are not an
automatic fallback. Local synthetic completion does not authorize activation.

For the retained v1 route only, use exported/browser snapshots for reads unless
exact reconciliation requires API-only evidence. Use its batch-update API for
approved mutations; on a provider limit, use only the shared policy's exact
import/browser fallback. Keep the existing v1 deployment and rollback evidence
until the replacement passes its operational cutover gates.

## Authorization

A request to inspect, compare, or calculate permits only a dry run. A request to
sync, update, apply, or reflect the metrics permits changes to the three metric
fields after a successful dry run in the same task.

Never create or delete records. Never change the month, account identity, or any
field outside diamonds, effective live days, and live minutes.

## Reconciliation

1. Validate the normalized snapshot, month, row count, non-negative integers,
   and normalized account-key uniqueness.
2. Run a dry run through the selected execution route. In v2, use the
   composition runner with explicit `mode: "dry-run"`; the current script
   requires injected `providerFactory` and `providerInput`, so invoking it as a
   standalone CLI does not supply a usable Provider. In the retained v1
   deployment, run its script without `--apply`.
3. Confirm every source account matches exactly one existing record in the
   target month. Leave destination-only accounts unchanged; do not fill them
   with zero.
4. Report the exact three-field diff. Stop if any account is missing or
   ambiguous, any configured field ID is missing, or any metric destination is
   not numeric.
5. If the user authorized the update and the reviewed scope still matches,
   use the same snapshot, destination and selected actor with v2 `mode: "apply"`
   and an explicit reviewed write selection; use `--apply` only in the retained
   v1 deployment. Reconcile changed inputs, actor, targets or counts before
   applying; previous approval does not cover a changed scope. The v2 runner
   does not itself capture user approval or consume a prior dry-run hash.
6. The script rereads fields and records after the write. Treat the run as
   successful only when all three metrics equal the requested values.

The script performs a single batch update and stops when more than 200 records
would change. A write with an uncertain response must not be retried immediately;
rerun a read-only check first.

## Credentials

For v2, the private runtime supplies explicit selected transport factories and
an owner-only profile bundle; it must prove the selected actor and access under
the Provider contract. Do not place credentials in the bundle or infer a
Principal from ambient environment settings.

For the retained v1 deployment only, use `LARK_TENANT_ACCESS_TOKEN`, or the pair
`LARK_APP_ID` and
`LARK_APP_SECRET`. A macOS keychain item may be selected with
`LARK_KEYCHAIN_SERVICE`; its account is the app ID and its password is the app
secret. Never place credential values in input JSON, configuration, logs, or Git.

## Completion report

Report the target month, source update time, source count, matched count, changed
count, unchanged count, verification status, and per-account metric result.
Separate missing, ambiguous, and verification errors. Do not expose credentials
or private provider instructions.
