# Tracker Adapters

Symphony reads work through tracker adapters. A project selects the adapter in its repository-owned
`WORKFLOW.md`, and the runtime turns that `tracker.kind` into a concrete `IssueTracker`
implementation.

Today the only bundled adapter is `linear`. The adapter layer exists so future platforms can be
added without changing orchestrator, workspace, dashboard, or prompt-rendering behavior.

## Runtime Boundary

The stable runtime contract is `IssueTracker`:

```ts
interface IssueTracker {
  fetchCandidateIssues(): Promise<Issue[]>;
  fetchIssuesByStates(stateNames: string[]): Promise<Issue[]>;
  fetchIssueStatesByIds(issueIds: string[]): Promise<IssueStateSnapshot[]>;
}
```

Adapters must normalize platform data into the shared `Issue` model:

- `id`: stable platform ID used for claims, retries, workspaces, and reconciliation.
- `identifier`: human-readable ticket key shown in logs, prompts, and dashboards.
- `title`: non-empty task title.
- `description`: task body or `null`.
- `priority`: integer priority where lower values dispatch first, or `null`.
- `state`: current workflow state/status name.
- `branchName`: platform-provided branch metadata, or `null`.
- `url`: browser URL for the ticket, or `null`.
- `labels`: lowercase labels.
- `blockedBy`: blockers with best-effort `id`, `identifier`, and `state`.
- `createdAt` and `updatedAt`: ISO timestamps or `null`.

The orchestrator treats every adapter the same after normalization. It sorts candidates by priority,
then creation time, then identifier. It dispatches only configured active states, stops workers when
state reconciliation leaves active states, and cleans workspaces for terminal states.

## WORKFLOW.md Selection

Adapter choice belongs to each target repository:

```yaml
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: ENG
  active_states: [Todo, In Progress]
  terminal_states: [Done, Canceled]
```

Common tracker fields:

- `kind`: adapter key. Currently supported: `linear`.
- `endpoint`: adapter API endpoint when the adapter supports overriding it.
- `api_key`: token value or `$ENV_VAR` reference.
- `active_states`: state names eligible for dispatch.
- `terminal_states`: state names that trigger terminal cleanup.

Adapter-specific fields stay under `tracker`. The config resolver preserves unknown tracker keys in
`config.tracker.adapterOptions`, so a future adapter can read fields such as `data_source_id`,
`board_id`, `workspace_id`, or property mappings without changing the shared config shape first.

## Recommended Ticket Shape

Connected systems should expose, or let the adapter derive, this minimum structure:

| Field | Required | Recommendation |
| --- | --- | --- |
| Stable ID | Yes | Use the platform's immutable ID, not a mutable title or URL. |
| Identifier | Yes | Prefer a short key such as `ENG-123`; otherwise derive a stable display key. |
| Title | Yes | Keep it concise and action-oriented. |
| Description | Recommended | Include acceptance criteria, constraints, and links. |
| Status | Yes | Map to a small workflow with active, handoff, and terminal states. |
| Priority | Recommended | Use integers where lower numbers are higher priority. |
| Labels | Optional | Normalize to lowercase. |
| Blockers | Optional | Return blocker state when available. |
| URL | Recommended | Link operators and agents back to the source ticket. |
| Created/updated timestamps | Recommended | Creation time is used for stable dispatch ordering. |

## Recommended Status Lifecycle

Use a small, explicit lifecycle. Names may differ by platform, but each state should map clearly to
one of these categories.

| Category | Example states | Symphony behavior |
| --- | --- | --- |
| Intake | Backlog, Triage | Not active. Symphony ignores these tickets. |
| Ready | Todo | Active. Eligible for dispatch when unclaimed and unblocked. |
| Running | In Progress | Active. Eligible for continuation and reconciliation. |
| Blocked | Blocked | Not active unless the adapter can safely pre-filter blocked work. |
| Handoff | In Review, Human Review | Not active and not terminal. The worker stops after reaching handoff. |
| Terminal | Done, Closed, Canceled, Duplicate | Terminal. Startup and reconciliation can clean the workspace. |

Recommended defaults:

```yaml
tracker:
  active_states: [Todo, In Progress]
  terminal_states: [Done, Closed, Canceled, Cancelled, Duplicate]
```

Current orchestration applies blocker gating to normalized `Todo` issues: a `Todo` issue with
blockers dispatches only when every blocker is in a terminal state. If an adapter uses a different
ready-state name, either normalize that state to `Todo` or pre-filter blocked candidates until this
policy becomes configurable.

## Adding an Adapter

1. Add a platform client under `src/tracker/<kind>-client.ts`.
2. Add a normalizer under `src/tracker/<kind>-normalize.ts`.
3. Implement `IssueTracker`.
4. Register the adapter in `src/tracker/adapters.ts`.
5. Define adapter-specific validation in the registry entry.
6. Add optional dynamic tools through `createDynamicTools` when the agent needs platform-native
   write access.
7. Export public adapter APIs from `src/index.ts` when useful.
8. Add unit tests for client requests, normalization, config validation, and registry behavior.
9. Update `docs/WORKFLOW.template.md` and this guide with the adapter fields.

Adapters should keep platform API details isolated. Do not add platform-specific branches to
`OrchestratorCore`, `OrchestratorRuntimeHost`, `WorkspaceManager`, dashboard rendering, or prompt
templates unless the shared product contract itself changes.
