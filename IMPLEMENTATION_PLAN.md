# Implementation Plan

This file is the required development sequence for this repository. Keep it in sync with
`SPEC.upstream.md` and update it when the implementation order changes.

## Tracker Adapter Layer

Goal: make tracker support extensible while preserving the existing Linear behavior.

### Task 1: Introduce the Adapter Boundary

Status: Complete

- Add a tracker adapter registry that maps `tracker.kind` from `WORKFLOW.md` to a concrete
  `IssueTracker` implementation.
- Move Linear client construction out of the runtime host into the registry.
- Move tracker-specific Codex dynamic tool injection behind the same adapter registry.
- Keep `linear` as the default and only bundled adapter in this task.
- Preserve existing Linear config behavior, including `LINEAR_API_KEY` fallback and
  `tracker.project_slug` validation.

Acceptance:

- Existing Linear workflows still start without config changes.
- Unsupported `tracker.kind` values fail during dispatch validation with the list of supported
  adapters.
- The runtime host no longer imports or constructs `LinearTrackerClient` directly.

### Task 2: Document the Adapter Contract

Status: Complete

- Document the normalized `IssueTracker` contract.
- Document how adapter-specific `WORKFLOW.md` fields are preserved for future adapters.
- Define the recommended ticket fields and status lifecycle that any connected tracking system
  should expose.
- Add a first-page README note so operators see that Symphony uses tracker adapters.

Acceptance:

- A contributor can create a new adapter by following the docs without reading Linear internals
  first.
- README explains that adapter choice happens in project-owned `WORKFLOW.md`.

### Task 3: Add the First Non-Linear Adapter

Status: Planned

- Select the next platform after product discovery.
- Add a dedicated client, normalizer, adapter registration, tests, and documentation.
- Do not add platform-specific assumptions to the orchestrator, workspace manager, dashboard, or
  prompt builder.

Acceptance:

- The new adapter implements the same `IssueTracker` behavior as Linear.
- Projects can switch adapters by changing `tracker.kind` and adapter-specific fields in
  `WORKFLOW.md`.

### Task 4: Harden Multi-Adapter Operations

Status: Planned

- Add conformance tests shared by all adapters.
- Add adapter smoke-test guidance for real credentials.
- Revisit any state-name-specific orchestration rules and promote them to config if needed.

Acceptance:

- Adapter behavior is verified through shared contract tests.
- New adapters do not need runtime-host or agent-runner edits unless adding new cross-cutting
  capabilities.
