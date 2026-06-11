import { describe, expect, it, vi } from "vitest";

import type { ResolvedWorkflowConfig } from "../../src/config/types.js";
import {
  LINEAR_GRAPHQL_TOOL_NAME,
  LinearTrackerClient,
  createTrackerDynamicTools,
  createTrackerFromConfig,
  getTrackerAdapterApiKeyEnv,
  listTrackerAdapterKinds,
  validateTrackerAdapterConfig,
} from "../../src/index.js";

describe("tracker adapters", () => {
  it("registers Linear as the default adapter implementation", () => {
    const config = createConfig();

    expect(listTrackerAdapterKinds()).toEqual(["linear"]);
    expect(getTrackerAdapterApiKeyEnv("Linear")).toBe("LINEAR_API_KEY");
    expect(createTrackerFromConfig(config)).toBeInstanceOf(LinearTrackerClient);
  });

  it("delegates dynamic tools to the selected adapter", () => {
    const tools = createTrackerDynamicTools(createConfig(), {
      fetchFn: vi.fn<typeof fetch>(),
    });

    expect(tools.map((tool) => tool.name)).toEqual([LINEAR_GRAPHQL_TOOL_NAME]);
  });

  it("reports unsupported adapter kinds with the registered options", () => {
    expect(
      validateTrackerAdapterConfig(
        createConfig({
          tracker: {
            ...createConfig().tracker,
            kind: "jira",
          },
        }),
      ),
    ).toEqual({
      code: "unsupported_tracker_kind",
      message:
        "tracker.kind 'jira' is not supported. Supported adapters: linear.",
    });
  });
});

function createConfig(
  overrides: Partial<ResolvedWorkflowConfig> = {},
): ResolvedWorkflowConfig {
  return {
    workflowPath: "/repo/WORKFLOW.md",
    promptTemplate: "Prompt",
    tracker: {
      kind: "linear",
      endpoint: "https://api.linear.app/graphql",
      apiKey: "token",
      projectSlug: "ENG",
      activeStates: ["Todo", "In Progress"],
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
