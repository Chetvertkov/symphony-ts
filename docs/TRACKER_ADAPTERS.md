# Tracker adapters

Symphony selects the tracker implementation through `tracker.kind` and the adapter registry in
`src/tracker/adapters.ts`.

## Supported adapters

| Kind | Auth fallback | Required fields | Optional dynamic tool |
| --- | --- | --- | --- |
| `linear` | `LINEAR_API_KEY` | `project_slug` | `linear_graphql` |
| `notion` | `NOTION_API_KEY` | `data_source_id`, `title_property`, `status_property` | none in MVP |

## Shared tracker fields

These fields are available for every adapter:

- `tracker.kind`
- `tracker.endpoint`
- `tracker.api_key`
- `tracker.active_states`
- `tracker.terminal_states`

Adapter-specific fields are written flat in `WORKFLOW.md`, but the config layer resolves them into
`config.tracker.adapterOptions` for the adapter factory.

## Linear

Linear behavior is unchanged:

- `src/tracker/linear-client.ts` still owns GraphQL reads.
- `src/codex/linear-graphql-tool.ts` still injects `linear_graphql`.
- `project_slug` remains required for dispatch.

## Notion

The Notion adapter reads pages from a single data source through the REST API.

### Required fields

- `data_source_id`
- `title_property`
- `status_property`

### Optional fields and fallbacks

- `identifier_property`: falls back to the first 8 hex chars of the page ID.
- `description_property`: falls back to `null`.
- `priority_property`: falls back to `null`.
- `labels_property`: falls back to `[]`.
- `blocked_by_property`: falls back to `[]`.

### Normalization

The adapter maps Notion pages to the shared `Issue` model like this:

- `id`: Notion page ID
- `identifier`: configured identifier property or short page ID fallback
- `title`: configured title property
- `description`: configured rich text property or `null`
- `priority`: number/select/status/formula best effort
- `state`: configured status/select property
- `branchName`: always `null`
- `url`: Notion page URL
- `labels`: lowercased `multi_select` or `select` values
- `blockedBy`: relation page IDs with best-effort identifier/state hydration
- `createdAt`: page `created_time`
- `updatedAt`: page `last_edited_time`

### Query behavior

- `fetchCandidateIssues()`: queries pages where status is in `active_states`
- `fetchIssuesByStates(stateNames)`: queries pages for the provided state names
- `fetchIssueStatesByIds(issueIds)`: retrieves the current state for each page ID
- pagination is implemented for data source queries and relation property expansion
- Notion queries are requested with `created_time` ascending sort; final dispatch ordering still
  happens in the orchestrator

## Notion write-back in MVP

This PR does not add a built-in `notion_api` dynamic tool yet.

To let an agent update a Notion ticket:

1. Export `NOTION_API_KEY` before launching Symphony.
2. Launch Codex with inherited env vars, for example
   `codex --config shell_environment_policy.inherit=all app-server`.
3. Allow network access in `codex.turn_sandbox_policy` when the workflow expects Notion writes.
4. Use standard HTTPS calls from the workflow environment, for example `PATCH /v1/pages/{page_id}`
   for status updates or `POST /v1/comments` for comments.

See [docs/NOTION_ADAPTER.md](./NOTION_ADAPTER.md) for full setup and examples.
