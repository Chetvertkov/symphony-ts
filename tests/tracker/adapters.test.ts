import { describe, expect, it, vi } from "vitest";

import type { ResolvedWorkflowConfig } from "../../src/config/types.js";
import {
  LINEAR_GRAPHQL_TOOL_NAME,
  LinearTrackerClient,
  NotionTrackerClient,
  createTrackerDynamicTools,
  createTrackerFromConfig,
} from "../../src/index.js";

describe("tracker adapters", () => {
  it("creates the legacy linear adapter from config", () => {
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

  it("preserves the linear dynamic tool and skips notion by default", () => {
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
});

function createLinearConfig(): ResolvedWorkflowConfig {
  return {
    workflowPath: "/repo/WORKFLOW.md",
    promptTemplate: "Prompt",
    tracker: {
      kind: "linear",
      endpoint: "https://api.linear.app/graphql",
      apiKey: "linear-token",
      projectSlug: "ENG",
      activeStates: ["Todo"],
      terminalStates: ["Done"],
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
    server: {
      port: null,
    },
    observability: {
      dashboardEnabled: true,
      refreshMs: 1_000,
      renderIntervalMs: 16,
    },
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
      terminalStates: ["Done", "Canceled"],
      adapterOptions: {
        dataSourceId: "data-source-1",
        titleProperty: "Name",
        statusProperty: "Status",
        identifierProperty: "Key",
        descriptionProperty: "Description",
        priorityProperty: "Priority",
        labelsProperty: "Labels",
        blockedByProperty: "Blocked by",
      },
    },
  };
}
