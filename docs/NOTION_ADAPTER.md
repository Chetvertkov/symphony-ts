# Notion adapter

This guide covers the MVP Notion tracker adapter that ships in `tracker.kind: notion`.

## What it supports

- reading candidate tickets from one Notion data source
- fetching pages by explicit workflow states
- reconciling current state by page ID
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
Implement the task, run validation, and leave the ticket in the expected handoff state.
```

## 7. How the agent updates status and comments

The MVP adapter does not inject a `notion_api` dynamic tool yet. Agents should use normal workflow
credentials instead.

### Status update

Use `PATCH /v1/pages/{page_id}` and update the configured status property under `properties`.

Example:

```bash
curl -X PATCH "https://api.notion.com/v1/pages/$PAGE_ID" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2026-03-11" \
  -H "Content-Type: application/json" \
  --data '{
    "properties": {
      "Status": {
        "status": { "name": "Done" }
      }
    }
  }'
```

### Comment

Use `POST /v1/comments` with `parent.page_id` plus either `rich_text` or `markdown`.

Example:

```bash
curl -X POST "https://api.notion.com/v1/comments" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2026-03-11" \
  -H "Content-Type: application/json" \
  --data '{
    "parent": { "page_id": "'"$PAGE_ID"'" },
    "markdown": "Implemented the requested change and ran validation."
  }'
```

To make those calls available inside an agent turn:

1. export `NOTION_API_KEY` before starting Symphony
2. use `codex --config shell_environment_policy.inherit=all app-server`
3. enable network access in `codex.turn_sandbox_policy`

## 8. MVP limitations

- the adapter reads from exactly one Notion data source
- there is no built-in `notion_api` dynamic tool yet
- `branchName` is always `null`
- priority mapping is heuristic for select/status labels
- blocker hydration is best-effort and depends on relation access
- linked data sources are not supported by the Notion API; share the original source instead
