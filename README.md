# Creator monthly activity reconciliation

Independent consumer package: `@flair-agency/creator-monthly-activity-reconcile`.
[SKILL.md](SKILL.md) describes the installed Runtime CLI workflow.

- `./contracts`: normalized activity validation, request scope, opaque selection
  evidence, and permitted metric changes; no I/O or concrete Provider imports.
- `./core`: pure matching, differences, and reports.
- `./application`: `reconcileMonthlyActivity` orchestrates injected `readActivity`,
  `readRecords`, and `applyChanges` operations and verifies readback.

A destination read returns `{ selection, records }`. Each record contains
`recordId`, `month`, `accountKey`, and `metrics` (`diamonds`, `effectiveLiveDays`,
`liveMinutes`). Selection contains opaque `readBinding`, `writeBinding`, and
`targetBinding` evidence. Service field schemas remain in the Provider.

A dry run returns its exact `plan`. Application requires that unchanged plan and
`authorization: { approved: true, selection }`, fresh destination matching, and a
separately selected write binding. It submits at most one batch and reconciles an
uncertain response by reading back without retrying. Runtime owns asynchronous
request correlation and private persistence.

Run `npm test` from this package after installing the parent development
composition. Tests use synthetic data. The retained `scripts/` exports support
migration parity tests; they are not the canonical consumer application API.
