# Private Lark configuration

Keep the configuration outside the public repository, for example under an
ignored `private/` directory.

```json
{
  "appToken": "local-app-token",
  "tableId": "local-table-id",
  "fieldIds": {
    "month": "field-id",
    "account": "field-id",
    "diamonds": "field-id",
    "effectiveLiveDays": "field-id",
    "liveMinutes": "field-id"
  }
}
```

The five field IDs must be present and distinct. The three metric destinations
must be numeric fields. Display names are intentionally absent because users may
rename them.

The file contains identifiers, not app credentials. For the retained v1
deployment, supply credentials through the environment or an explicitly selected
keychain item.

## V2 selected runtime

Use the composition runtime's activity runner, with its owner-only profile
bundle and explicitly injected selected Provider and transport factories.
The five-field configuration above remains the reconciliation shape; it is not
a v2 profile bundle and cannot establish actor or access authority.

The bundle selects one organization, read Instance Profile/route and Principal,
and the exact Base, table and five field IDs. Read operations are `fields:list`
and `records:search`. Apply additionally requires an explicit write
Instance Profile/route for `records:batch-update`, using the same Principal and
destination. User and Tenant support is subject to the selected operation and
transport checks; never switch actors to recover from a failed selection.

Use explicit `dry-run` or `apply` mode. The caller validates the normalized
snapshot before handing it to the runner and retains the same-scope user
authorization described in SKILL.md. The runner recomputes the reconciliation
and verifies post-write metrics; it does not accept a prior approval hash.
Missing or inactive profiles, unsupported selections or unavailable transport
proof stop the v2 route. Retain the v1 deployment as a separate rollback path;
this local interface documentation supplies no live, unattended or cutover proof.
