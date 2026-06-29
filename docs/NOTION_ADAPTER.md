# Notion adapter

This guide covers the MVP Notion tracker adapter that ships in `tracker.kind: notion`.

## What it supports

- reading candidate tickets from one Notion data source
- fetching pages by explicit workflow states
- reconciling current state by page ID
- claiming eligible tasks into a configured running state before Codex starts
- handing ready work off through the adapter-neutral `symphony_handoff` tool
- normalizing Notion pages into Symphony `Issue` objects
- best-effort blocker hydration through relation properties

## 1. Create a token

Use either:

- an internal Notion connection token
- a personal access token, where your workspace policy allows it

Expose it as `NOTION_API_KEY`. This is the canonical environment fallback for
`tracker.kind: notion`.

## 2. Share the data source with the connection

Share the target database/data source with the integration before running Symphony.

If you configure `blocked_by_property`, also share the related data source that the relation points
to. Otherwise Notion may omit relation schema or relation values from API responses.

## 3. Find the data source ID

Use the Notion UI's "Copy data source ID" action or extract it from the database URL.

## 4. Create the required properties

Required:

| Workflow field | Recommended Notion type | Notes |
| --- | --- | --- |
| `title_property` | `title` | Human-readable ticket title |
| `status_property` | `status` or `select` | Dispatch and reconciliation read from here |
| `data_source_id` | n/a | Target data source ID |

Optional:

| Workflow field | Recommended type | Fallback when omitted |
| --- | --- | --- |
| `identifier_property` | `rich_text`, `title`, `unique_id`, `number`, `select`, `status`, or string/number `formula` | short page ID |
| `description_property` | `rich_text` | `null` |
| `priority_property` | `number`, `select`, `status`, or number/string `formula` | `null` |
| `labels_property` | `multi_select` or `select` | `[]` |
| `blocked_by_property` | `relation` | `[]` |

## 5. Recommended statuses

Recommended active states:

- `Todo`
- `In Progress`

Recommended lifecycle write-back states:

- `claim_state`: `In Progress`
- `handoff_states`: `In Review`, `Review`
- `blocked_state`: `Needs decision`

Recommended terminal states:

- `Done`
- `Closed`
- `Canceled`
- `Cancelled`
- `Duplicate`

## 6. Example WORKFLOW.md

```md
---
tracker:
  kind: notion
  api_key: $NOTION_API_KEY
  data_source_id: "your-notion-data-source-id"
  active_states: [Todo, In Progress]
  claim_state: In Progress
  handoff_states: [In Review, Review]
  blocked_state: Needs decision
  require_claim_before_agent: true
  terminal_states: [Done, Closed, Canceled, Cancelled, Duplicate]

  title_property: Name
  status_property: Status
  identifier_property: Key
  description_property: Description
  priority_property: Priority
  labels_property: Labels
  blocked_by_property: Blocked by

workspace:
  root: ~/symphony-workspaces/your-repo

hooks:
  after_create: |
    git clone git@github.com:your-org/your-repo.git .
    pnpm install

codex:
  command: codex --config shell_environment_policy.inherit=all app-server
  turn_sandbox_policy:
    type: workspaceWrite
    writableRoots:
      - ~/symphony-workspaces/your-repo
    readOnlyAccess:
      type: fullAccess
    networkAccess: true
---

You are working on Notion issue {{ issue.identifier }}.
Implement the task and run validation. When the PR is ready for review, call `symphony_handoff`
with the PR URL, head SHA, validation summary, and residual risks.
```

## 7. Lifecycle write-back

The Notion adapter owns status lifecycle writes. Agents should not make raw Notion status REST
calls from the workflow prompt.

### Claim

When Symphony dispatches a Notion task and `require_claim_before_agent` is true, it validates
`claim_state` against the data source schema and writes that exact `status` or `select` option
before starting the Codex app-server session. If the write or read-back fails, Codex is not
started; Symphony surfaces `tracker_claim_failed` in logs, dashboard state, and the JSON API.

### Handoff

When repository-owned workflow checks say the PR is ready, call the injected tool:

```json
{
  "ready_for_review": true,
  "pr_url": "https://github.com/your-org/your-repo/pull/123",
  "pr_number": "123",
  "head_sha": "abc123",
  "validation_summary": "pnpm test, pnpm typecheck, pnpm lint passed",
  "risks": "No known residual risks"
}
```

Symphony selects the first configured exact match from `handoff_states`, writes it to Notion, and
suppresses continuation after the successful tool call. It never moves tickets to `Done`, `Closed`,
or another terminal state unless your workflow explicitly instructs the agent to do so through a
separate mechanism.

If no configured handoff option exists, Symphony reports a validation error listing available
Notion options. If the handoff status write fails, Symphony pauses automatic continuation and
surfaces `tracker_handoff_failed` for operator action instead of burning another Codex turn.

### Comments

Comments are optional checkpointing. The lifecycle path does not depend on comment write access:
if page/status writes work, status transition still succeeds even when Notion comments are
unavailable.

## 8. Operational notes

- `claim_state` and `handoff_states` must exactly match Notion option names.
- `status_property` may be either Notion `status` or `select`.
- Vercel, deploy, or CI statuses are workflow evidence only; Symphony lifecycle readiness is driven
  by the structured handoff tool.
- Normal worker exit without handoff can still continue while the ticket stays active, but repeated
  exits with unchanged evidence are held as `no_progress_or_handoff_missing`.

## 9. MVP limitations

- the adapter reads from exactly one Notion data source
- `branchName` is always `null`
- priority mapping is heuristic for select/status labels
- blocker hydration is best-effort and depends on relation access
- linked data sources are not supported by the Notion API; share the original source instead
