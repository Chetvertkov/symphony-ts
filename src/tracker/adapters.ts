import type { CodexDynamicTool } from "../codex/app-server-client.js";
import { createLinearGraphqlDynamicTool } from "../codex/linear-graphql-tool.js";
import type {
  DispatchValidationFailure,
  ResolvedWorkflowConfig,
} from "../config/types.js";
import { ERROR_CODES } from "../errors/codes.js";
import { TrackerError } from "./errors.js";
import { LinearTrackerClient } from "./linear-client.js";
import {
  NotionTrackerClient,
  readNotionTrackerAdapterOptions,
} from "./notion-client.js";
import type { IssueTracker } from "./tracker.js";

export interface TrackerDynamicToolOptions {
  fetchFn?: typeof fetch;
}

export interface TrackerAdapterDefinition {
  kind: string;
  displayName: string;
  canonicalApiKeyEnv: string | null;
  validateConfig(
    config: ResolvedWorkflowConfig,
  ): DispatchValidationFailure | null;
  createTracker(
    config: ResolvedWorkflowConfig,
    options?: TrackerDynamicToolOptions,
  ): IssueTracker;
  createDynamicTools(
    config: ResolvedWorkflowConfig,
    options?: TrackerDynamicToolOptions,
  ): CodexDynamicTool[];
}

const LINEAR_ADAPTER: TrackerAdapterDefinition = {
  kind: "linear",
  displayName: "Linear",
  canonicalApiKeyEnv: "LINEAR_API_KEY",
  validateConfig(config) {
    if (!config.tracker.apiKey || config.tracker.apiKey.trim() === "") {
      return {
        code: ERROR_CODES.trackerCredentialsMissing,
        message: "tracker.api_key must be configured before dispatch.",
      };
    }

    if (
      !config.tracker.projectSlug ||
      config.tracker.projectSlug.trim() === ""
    ) {
      return {
        code: ERROR_CODES.configInvalid,
        message: "tracker.project_slug must be configured before dispatch.",
      };
    }

    return null;
  },
  createTracker(config, options) {
    return new LinearTrackerClient({
      endpoint: config.tracker.endpoint,
      apiKey: config.tracker.apiKey,
      projectSlug: config.tracker.projectSlug,
      activeStates: config.tracker.activeStates,
      ...(options?.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }),
    });
  },
  createDynamicTools(config, options) {
    return [
      createLinearGraphqlDynamicTool({
        endpoint: config.tracker.endpoint,
        apiKey: config.tracker.apiKey,
        ...(options?.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }),
      }),
    ];
  },
};

const NOTION_ADAPTER: TrackerAdapterDefinition = {
  kind: "notion",
  displayName: "Notion",
  canonicalApiKeyEnv: "NOTION_API_KEY",
  validateConfig(config) {
    if (!config.tracker.apiKey || config.tracker.apiKey.trim() === "") {
      return {
        code: ERROR_CODES.trackerCredentialsMissing,
        message: "tracker.api_key must be configured before dispatch.",
      };
    }

    const options = readNotionTrackerAdapterOptions(
      config.tracker.adapterOptions,
    );

    if (!options.dataSourceId) {
      return {
        code: ERROR_CODES.configInvalid,
        message: "tracker.data_source_id must be configured before dispatch.",
      };
    }

    if (!options.titleProperty) {
      return {
        code: ERROR_CODES.configInvalid,
        message: "tracker.title_property must be configured before dispatch.",
      };
    }

    if (!options.statusProperty) {
      return {
        code: ERROR_CODES.configInvalid,
        message: "tracker.status_property must be configured before dispatch.",
      };
    }

    return null;
  },
  createTracker(config, options) {
    return new NotionTrackerClient({
      endpoint: config.tracker.endpoint,
      apiKey: config.tracker.apiKey,
      activeStates: config.tracker.activeStates,
      ...readNotionTrackerAdapterOptions(config.tracker.adapterOptions),
      ...(options?.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }),
    });
  },
  createDynamicTools() {
    return [];
  },
};

const TRACKER_ADAPTERS = Object.freeze([LINEAR_ADAPTER, NOTION_ADAPTER]);

export function listTrackerAdapterKinds(): string[] {
  return TRACKER_ADAPTERS.map((adapter) => adapter.kind);
}

export function normalizeTrackerKind(kind: string | null | undefined): string {
  return kind?.trim().toLowerCase() ?? "";
}

export function getTrackerAdapterDefinition(
  kind: string | null | undefined,
): TrackerAdapterDefinition | null {
  const normalizedKind = normalizeTrackerKind(kind);
  return (
    TRACKER_ADAPTERS.find((adapter) => adapter.kind === normalizedKind) ?? null
  );
}

export function getTrackerAdapterApiKeyEnv(
  kind: string | null | undefined,
): string | null {
  return getTrackerAdapterDefinition(kind)?.canonicalApiKeyEnv ?? null;
}

export function validateTrackerAdapterConfig(
  config: ResolvedWorkflowConfig,
): DispatchValidationFailure | null {
  const trackerKind = config.tracker.kind?.trim();
  if (!trackerKind) {
    return {
      code: ERROR_CODES.configInvalid,
      message: "tracker.kind must be present before dispatch.",
    };
  }

  const adapter = getTrackerAdapterDefinition(trackerKind);
  if (adapter === null) {
    return {
      code: ERROR_CODES.unsupportedTrackerKind,
      message: `tracker.kind '${trackerKind}' is not supported. Supported adapters: ${listTrackerAdapterKinds().join(", ")}.`,
    };
  }

  return adapter.validateConfig(config);
}

export function createTrackerFromConfig(
  config: ResolvedWorkflowConfig,
  options?: TrackerDynamicToolOptions,
): IssueTracker {
  const adapter = getTrackerAdapterDefinition(config.tracker.kind);
  if (adapter === null) {
    throw new TrackerError(
      ERROR_CODES.unsupportedTrackerKind,
      `Tracker kind '${config.tracker.kind ?? ""}' is not supported.`,
    );
  }

  return adapter.createTracker(config, options);
}

export function createTrackerDynamicTools(
  config: ResolvedWorkflowConfig,
  options?: TrackerDynamicToolOptions,
): CodexDynamicTool[] {
  const adapter = getTrackerAdapterDefinition(config.tracker.kind);
  return adapter?.createDynamicTools(config, options) ?? [];
}
