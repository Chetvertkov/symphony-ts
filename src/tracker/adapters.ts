import type { CodexDynamicTool } from "../codex/app-server-client.js";
import { createLinearGraphqlDynamicTool } from "../codex/linear-graphql-tool.js";
import type { ResolvedWorkflowConfig } from "../config/types.js";
import { ERROR_CODES } from "../errors/codes.js";
import { LinearTrackerClient } from "./linear-client.js";
import {
  NotionTrackerClient,
  readNotionTrackerAdapterOptions,
} from "./notion-client.js";
import type { IssueTracker } from "./tracker.js";

export const SUPPORTED_TRACKER_KINDS = ["linear", "notion"] as const;

export type SupportedTrackerKind = (typeof SUPPORTED_TRACKER_KINDS)[number];

export function createTrackerFromConfig(
  config: ResolvedWorkflowConfig,
  input: {
    fetchFn?: typeof fetch;
  } = {},
): IssueTracker {
  switch (toTrackerKind(config.tracker.kind)) {
    case "linear":
      return new LinearTrackerClient({
        endpoint: config.tracker.endpoint,
        apiKey: config.tracker.apiKey,
        projectSlug: config.tracker.projectSlug,
        activeStates: config.tracker.activeStates,
        ...(input.fetchFn === undefined ? {} : { fetchFn: input.fetchFn }),
      });
    case "notion": {
      const notionOptions = readNotionTrackerAdapterOptions(
        config.tracker.adapterOptions,
      );
      return new NotionTrackerClient({
        endpoint: config.tracker.endpoint,
        apiKey: config.tracker.apiKey,
        activeStates: config.tracker.activeStates,
        ...notionOptions,
        ...(input.fetchFn === undefined ? {} : { fetchFn: input.fetchFn }),
      });
    }
    default:
      throw new Error(
        `${ERROR_CODES.unsupportedTrackerKind}:${config.tracker.kind ?? "unknown"}`,
      );
  }
}

export function createTrackerDynamicTools(
  config: ResolvedWorkflowConfig,
  input: {
    fetchFn?: typeof fetch;
  } = {},
): CodexDynamicTool[] {
  switch (toTrackerKind(config.tracker.kind)) {
    case "linear":
      return [
        createLinearGraphqlDynamicTool({
          endpoint: config.tracker.endpoint,
          apiKey: config.tracker.apiKey,
          ...(input.fetchFn === undefined ? {} : { fetchFn: input.fetchFn }),
        }),
      ];
    case "notion":
      return [];
    default:
      return [];
  }
}

function toTrackerKind(kind: string | null): SupportedTrackerKind | "unknown" {
  const normalized = kind?.trim().toLowerCase();
  if (normalized === "linear" || normalized === "notion") {
    return normalized;
  }

  return "unknown";
}
