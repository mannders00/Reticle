# Migrating To Reticle v1.2

Back up the topology, tokens, unit configuration, and audit records before the
upgrade. Follow the full [production runbook](production-deployment.md) for
binary verification, upgrade, and rollback.

## Configuration Changes

1. Replace the legacy daemon option `--allow-custom-checks` with
   `--allow-custom-commands` in service units, container arguments, and operator
   documentation. Restart the daemon after changing startup policy.
2. Replace legacy fixed SSH probe names `service.restart` or `service.reload`.
   They are not v1.2 checks. Use `service.status` for observation and define an
   editor-invoked named action when a reviewed restart or reload is required.
3. Review every custom check before enabling the Team daemon flag or Desktop
   privileged mode. UI-created checks now default to enabled and viewer-visible;
   set `enabled: false` or `publishOutput: false` explicitly when needed.
4. Remove any process or form documentation that expects a per-check risk
   acknowledgment. v1.2 has no such field. Desktop uses one global privileged
   toggle for all custom checks and actions in the active workspace.
5. Ensure local `shell.command` definitions run only on Unix hosts with Bash.
   Disable or replace them before moving a topology to Windows.

## Team Client And Access Changes

- Start Team with `--allow-custom-commands` only when custom checks or named
  actions are intended. UI/API management requires an editor token.
- Named-action clients must send `actionId`, `baseRev`, and `approved`. Refresh
  and ask the operator to review again after a stale-revision refusal.
- Do not expose terminal UI or ad-hoc shell routes. Team rejects those command
  paths; the graph API, MCP, and chat are read-only.
- Continue using separate view and edit tokens. Non-loopback binding requires a
  view token, and `--open` is for loopback development only.

## Audit And Operations

- `--audit-log` is opt-in. Provision a protected writable path before startup.
- Update parsers for `connect`, `disconnect`, privileged request command names,
  stale/validation save records, and `named_action_result` records. Do not assume
  exactly one record per user action.
- Treat `detail.error` as potentially sensitive operational metadata even though
  command text and output are omitted.
- Configure audit rotation and topology backup. The in-memory observation ring
  is not backed up and resets on restart.

## Verification

1. Confirm a viewer can inspect the graph but cannot edit, refresh, chat, manage
   custom checks, or invoke actions.
2. Confirm an editor can save with a current revision and receives a stale-save
   refusal from an old browser tab.
3. Confirm a named action with an old `baseRev` is refused.
4. Confirm Team has no browser terminal or ad-hoc command path.
5. Confirm local Bash capability is absent on non-Unix hosts.
6. Confirm audit creation, permissions, rotation, and restore procedures.
