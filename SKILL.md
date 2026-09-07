---
name: live-agency-creator-monthly-activity-reconcile
description: Reconcile normalized monthly creator activity against existing records, prepare exact metric changes, and verify explicitly authorized updates. Use for monthly comparisons or approved updates, not source acquisition or record creation.
---

# Reconcile monthly creator activity

Use the installed `live-agency` Runtime CLI supplied by the explicitly selected
development composition. This Skill owns monthly matching, metric differences,
update conditions, and readback verification. Runtime selects and connects the
source and destination implementations. The consumer does not select services,
credentials, tables, or field schemas.

## Inputs and selection

Require a target month (`YYYY-MM`) and an explicit nonempty `accountKeys` array.
Accept only normalized activity conforming to
[the activity contract](references/normalized-activity-schema.md). Source-specific
acquisition and conversion belong to the selected Provider. Do not infer unknown
schemas or operate an authenticated source from this Skill.

Require explicit paths to an installed composition root, development
configuration, request JSON, and private state directory. Runtime configuration
selects compatible Provider capabilities and versions, read and write authority,
and opaque destination selection evidence. Missing or changed selection stops
the operation; available credentials are not selection.

## Dry run

Run the installed executable with the selected paths:

```sh
live-agency monthly-activity --root /selected/composition --configuration /private/configuration.json --request /private/request.json --state-dir /private/state
```

The CLI distinguishes `done`, `interaction-required`, and `failed`. For
`interaction-required`, follow only the selected Provider's bounded instructions
and return its correlated result with `--resume /private/result.json`. Preserve
the request ID, capability/version, month, and account scope. A different request
or scope cannot complete the pending operation.

Inspect the returned `output.plan`. Every source account must match exactly one
existing record in the requested month. Report missing and ambiguous matches;
do not create records. Leave destination-only accounts unchanged. Report the
three metrics: diamonds, effective live days, and live minutes. Stop for invalid
values or unresolved matching.

## Authorized application

A comparison request authorizes only the dry run. An explicit update request
permits the reviewed three-metric changes after the successful dry run. Never
create or delete records or alter account, month, or other fields.

Preserve the exact reviewed `output.plan` as private JSON. Supply an authorization
object with `approved: true` and the same opaque `selection` only when the user
has authorized that scope. Invoke the same command with
`--approved-plan /private/approved-plan.json --authorization /private/authorization.json`.
The application rereads and rejects a changed plan or selection before writing.
Changed actors, scope, source values, or destinations require a new reviewed
plan within the applicable user authority. More than 200 changes stop the batch.

After submission, the application rereads the destination and checks metrics and
record identities. An unknown write outcome requires readback; do not replay the
write automatically. Report success only when readback proves the requested
values. A synthetic development result does not authorize live activation.

## Completion

Report month, source update time/count, matched/change/unchanged counts,
verification, and any missing, ambiguous, conflict, or uncertain result. Keep
private configuration, credentials, source instructions, and audit data out of
public output and Git.
