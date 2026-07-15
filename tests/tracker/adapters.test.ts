import { describe, expect, it, vi } from "vitest";

import type { ResolvedWorkflowConfig } from "../../src/config/types.js";
import {
  LINEAR_GRAPHQL_TOOL_NAME,
  LinearTrackerClient,
  NotionTrackerClient,
  createTrackerDynamicTools,
  createTrackerFromConfig,
  getTrackerAdapterApiKeyEnv,
  listTrackerAdapterKinds,
  validateTrackerAdapterConfig,
} from "../../src/index.js";

describe("tracker adapters", () => {
  it("registers bundled adapters and their canonical API key env vars", () => {
    expect(listTrackerAdapterKinds()).toEqual(["linear", "notion"]);
    expect(getTrackerAdapterApiKeyEnv("Linear")).toBe("LINEAR_API_KEY");
    expect(getTrackerAdapterApiKeyEnv("notion")).toBe("NOTION_API_KEY");
  });

  it("creates the linear adapter from config", () => {
    const tracker = createTrackerFromConfig(createLinearConfig(), {
      fetchFn: vi.fn<typeof fetch>(),
    });

    expect(tracker).toBeInstanceOf(LinearTrackerClient);
  });

  it("creates the notion adapter from config.tracker.adapterOptions", () => {
    const tracker = createTrackerFromConfig(createNotionConfig(), {
      fetchFn: vi.fn<typeof fetch>(),
    });

    expect(tracker).toBeInstanceOf(NotionTrackerClient);
  });

  it("delegates dynamic tools to the selected adapter", () => {
    const linearTools = createTrackerDynamicTools(createLinearConfig(), {
      fetchFn: vi.fn<typeof fetch>(),
    });
    const notionTools = createTrackerDynamicTools(createNotionConfig(), {
      fetchFn: vi.fn<typeof fetch>(),
    });

    expect(linearTools.map((tool) => tool.name)).toEqual([
      LINEAR_GRAPHQL_TOOL_NAME,
    ]);
    expect(notionTools).toEqual([]);
  });

  it("reports unsupported adapter kinds with the registered options", () => {
    expect(
      validateTrackerAdapterConfig(
        createLinearConfig({
          tracker: {
            ...createLinearConfig().tracker,
            kind: "jira",
          },
        }),
      ),
    ).toEqual({
      code: "unsupported_tracker_kind",
      message:
        "tracker.kind 'jira' is not supported. Supported adapters: linear, notion.",
    });
  });
});

function createLinearConfig(
  overrides: Partial<ResolvedWorkflowConfig> = {},
): ResolvedWorkflowConfig {
  return {
    workflowPath: "/repo/WORKFLOW.md",
    promptTemplate: "Prompt",
    tracker: {
      kind: "linear",
      endpoint: "https://api.linear.app/graphql",
      apiKey: "linear-token",
      projectSlug: "ENG",
      activeStates: ["Todo", "In Progress"],
      claimState: "In Progress",
      handoffStates: ["In Review", "Review"],
      blockedState: "Needs decision",
      requireClaimBeforeAgent: true,
      terminalStates: ["Done", "Canceled"],
      adapterOptions: {},
    },
    polling: {
      intervalMs: 30_000,
    },
    workspace: {
      root: "/tmp/symphony",
    },
    hooks: {
      afterCreate: null,
      beforeRun: null,
      afterRun: null,
      beforeRemove: null,
      timeoutMs: 60_000,
    },
    agent: {
      maxConcurrentAgents: 10,
      maxTurns: 20,
      maxRetryBackoffMs: 300_000,
      maxConcurrentAgentsByState: {},
    },
    codex: {
      command: "codex app-server",
      approvalPolicy: null,
      threadSandbox: null,
      turnSandboxPolicy: null,
      turnTimeoutMs: 3_600_000,
      readTimeoutMs: 5_000,
      stallTimeoutMs: 300_000,
    },
    capabilities: {
      github: {
        required: false,
      },
    },
    server: {
      port: null,
    },
    observability: {
      dashboardEnabled: true,
      refreshMs: 1_000,
      renderIntervalMs: 16,
    },
    ...overrides,
  };
}

function createNotionConfig(): ResolvedWorkflowConfig {
  return {
    ...createLinearConfig(),
    tracker: {
      kind: "notion",
      endpoint: "https://api.notion.com/v1",
      apiKey: "notion-token",
      projectSlug: null,
      activeStates: ["Todo", "In Progress"],
      claimState: "In Progress",
      handoffStates: ["In Review", "Review"],
      blockedState: "Needs decision",
      requireClaimBeforeAgent: true,
      terminalStates: ["Done", "Canceled"],
      adapterOptions: {
        data_source_id: "data-source-1",
        title_property: "Name",
        status_property: "Status",
        identifier_property: "Key",
        description_property: "Description",
        priority_property: "Priority",
        labels_property: "Labels",
        blocked_by_property: "Blocked by",
      },
    },
  };
}
