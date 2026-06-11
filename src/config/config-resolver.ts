import { homedir } from "node:os";
import { isAbsolute, normalize, resolve, sep } from "node:path";

import type { WorkflowDefinition } from "../domain/model.js";
import { normalizeIssueState } from "../domain/model.js";
import { ERROR_CODES } from "../errors/codes.js";
import {
  DEFAULT_ACTIVE_STATES,
  DEFAULT_CODEX_COMMAND,
  DEFAULT_HOOK_TIMEOUT_MS,
  DEFAULT_LINEAR_ENDPOINT,
  DEFAULT_LINEAR_NETWORK_TIMEOUT_MS,
  DEFAULT_LINEAR_PAGE_SIZE,
  DEFAULT_MAX_CONCURRENT_AGENTS,
  DEFAULT_MAX_CONCURRENT_AGENTS_BY_STATE,
  DEFAULT_MAX_RETRY_BACKOFF_MS,
  DEFAULT_MAX_TURNS,
  DEFAULT_NOTION_ENDPOINT,
  DEFAULT_OBSERVABILITY_ENABLED,
  DEFAULT_OBSERVABILITY_REFRESH_MS,
  DEFAULT_OBSERVABILITY_RENDER_INTERVAL_MS,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_READ_TIMEOUT_MS,
  DEFAULT_STALL_TIMEOUT_MS,
  DEFAULT_TERMINAL_STATES,
  DEFAULT_TRACKER_KIND,
  DEFAULT_TURN_TIMEOUT_MS,
  DEFAULT_WORKSPACE_ROOT,
} from "./defaults.js";
import type {
  DispatchValidationResult,
  ResolvedWorkflowConfig,
} from "./types.js";

const LINEAR_CANONICAL_API_KEY_ENV = "LINEAR_API_KEY";
const NOTION_CANONICAL_API_KEY_ENV = "NOTION_API_KEY";

export function resolveWorkflowConfig(
  workflow: WorkflowDefinition & { workflowPath: string },
  environment: NodeJS.ProcessEnv = process.env,
): ResolvedWorkflowConfig {
  const config = workflow.config;
  const tracker = asRecord(config.tracker);
  const polling = asRecord(config.polling);
  const workspace = asRecord(config.workspace);
  const hooks = asRecord(config.hooks);
  const agent = asRecord(config.agent);
  const codex = asRecord(config.codex);
  const server = asRecord(config.server);
  const observability = asRecord(config.observability);
  const trackerKind = readString(tracker.kind) ?? DEFAULT_TRACKER_KIND;

  return {
    workflowPath: workflow.workflowPath,
    promptTemplate: workflow.promptTemplate,
    tracker: {
      kind: trackerKind,
      endpoint:
        readString(tracker.endpoint) ?? defaultTrackerEndpoint(trackerKind),
      apiKey:
        resolveEnvReference(readString(tracker.api_key), environment) ??
        defaultTrackerApiKey(trackerKind, environment) ??
        null,
      projectSlug: readString(tracker.project_slug),
      activeStates: readStringList(
        tracker.active_states,
        DEFAULT_ACTIVE_STATES,
      ),
      terminalStates: readStringList(
        tracker.terminal_states,
        DEFAULT_TERMINAL_STATES,
      ),
      adapterOptions: resolveTrackerAdapterOptions(tracker, environment),
    },
    polling: {
      intervalMs: readInteger(polling.interval_ms) ?? DEFAULT_POLL_INTERVAL_MS,
    },
    workspace: {
      root:
        resolvePathValue(
          readString(workspace.root),
          workflow.workflowPath,
          environment,
        ) ?? DEFAULT_WORKSPACE_ROOT,
    },
    hooks: {
      afterCreate: readScript(hooks.after_create),
      beforeRun: readScript(hooks.before_run),
      afterRun: readScript(hooks.after_run),
      beforeRemove: readScript(hooks.before_remove),
      timeoutMs:
        readPositiveInteger(hooks.timeout_ms) ?? DEFAULT_HOOK_TIMEOUT_MS,
    },
    agent: {
      maxConcurrentAgents:
        readPositiveInteger(agent.max_concurrent_agents) ??
        DEFAULT_MAX_CONCURRENT_AGENTS,
      maxTurns: readPositiveInteger(agent.max_turns) ?? DEFAULT_MAX_TURNS,
      maxRetryBackoffMs:
        readPositiveInteger(agent.max_retry_backoff_ms) ??
        DEFAULT_MAX_RETRY_BACKOFF_MS,
      maxConcurrentAgentsByState: readStateConcurrencyMap(
        agent.max_concurrent_agents_by_state,
      ),
    },
    codex: {
      command: readString(codex.command) ?? DEFAULT_CODEX_COMMAND,
      approvalPolicy: codex.approval_policy,
      threadSandbox: codex.thread_sandbox,
      turnSandboxPolicy: codex.turn_sandbox_policy,
      turnTimeoutMs:
        readPositiveInteger(codex.turn_timeout_ms) ?? DEFAULT_TURN_TIMEOUT_MS,
      readTimeoutMs:
        readPositiveInteger(codex.read_timeout_ms) ?? DEFAULT_READ_TIMEOUT_MS,
      stallTimeoutMs:
        readInteger(codex.stall_timeout_ms) ?? DEFAULT_STALL_TIMEOUT_MS,
    },
    server: {
      port: readNonNegativeInteger(server.port),
    },
    observability: {
      dashboardEnabled:
        readBoolean(observability.dashboard_enabled) ??
        DEFAULT_OBSERVABILITY_ENABLED,
      refreshMs:
        readPositiveInteger(observability.refresh_ms) ??
        DEFAULT_OBSERVABILITY_REFRESH_MS,
      renderIntervalMs:
        readPositiveInteger(observability.render_interval_ms) ??
        DEFAULT_OBSERVABILITY_RENDER_INTERVAL_MS,
    },
  };
}

export function validateDispatchConfig(
  config: ResolvedWorkflowConfig,
): DispatchValidationResult {
  const trackerKind = config.tracker.kind?.trim();
  if (!trackerKind) {
    return invalid(
      ERROR_CODES.configInvalid,
      "tracker.kind must be present before dispatch.",
    );
  }

  const normalizedTrackerKind = normalizeIssueState(trackerKind);
  if (
    normalizedTrackerKind !== DEFAULT_TRACKER_KIND &&
    normalizedTrackerKind !== "notion"
  ) {
    return invalid(
      ERROR_CODES.unsupportedTrackerKind,
      `tracker.kind '${trackerKind}' is not supported.`,
    );
  }

  if (!config.tracker.apiKey || config.tracker.apiKey.trim() === "") {
    return invalid(
      ERROR_CODES.trackerCredentialsMissing,
      "tracker.api_key must be configured before dispatch.",
    );
  }

  if (normalizedTrackerKind === DEFAULT_TRACKER_KIND) {
    if (
      !config.tracker.projectSlug ||
      config.tracker.projectSlug.trim() === ""
    ) {
      return invalid(
        ERROR_CODES.configInvalid,
        "tracker.project_slug must be configured before dispatch.",
      );
    }
  }

  if (normalizedTrackerKind === "notion") {
    const dataSourceId = readAdapterOption(
      config.tracker.adapterOptions,
      "dataSourceId",
    );
    if (!dataSourceId) {
      return invalid(
        ERROR_CODES.configInvalid,
        "tracker.data_source_id must be configured before dispatch.",
      );
    }

    const titleProperty = readAdapterOption(
      config.tracker.adapterOptions,
      "titleProperty",
    );
    if (!titleProperty) {
      return invalid(
        ERROR_CODES.configInvalid,
        "tracker.title_property must be configured before dispatch.",
      );
    }

    const statusProperty = readAdapterOption(
      config.tracker.adapterOptions,
      "statusProperty",
    );
    if (!statusProperty) {
      return invalid(
        ERROR_CODES.configInvalid,
        "tracker.status_property must be configured before dispatch.",
      );
    }
  }

  if (config.codex.command.trim() === "") {
    return invalid(
      ERROR_CODES.configInvalid,
      "codex.command must be present and non-empty before dispatch.",
    );
  }

  return { ok: true };
}

function invalid(code: string, message: string): DispatchValidationResult {
  return {
    ok: false,
    error: {
      code,
      message,
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return value;
}

function readScript(value: unknown): string | null {
  const script = readString(value);
  if (script === null) {
    return null;
  }

  return script === "" ? null : script;
}

function resolveTrackerAdapterOptions(
  tracker: Record<string, unknown>,
  environment: NodeJS.ProcessEnv,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    dataSourceId: readEnvBackedString(tracker.data_source_id, environment),
    titleProperty: readEnvBackedString(tracker.title_property, environment),
    statusProperty: readEnvBackedString(tracker.status_property, environment),
    identifierProperty: readEnvBackedString(
      tracker.identifier_property,
      environment,
    ),
    descriptionProperty: readEnvBackedString(
      tracker.description_property,
      environment,
    ),
    priorityProperty: readEnvBackedString(
      tracker.priority_property,
      environment,
    ),
    labelsProperty: readEnvBackedString(tracker.labels_property, environment),
    blockedByProperty: readEnvBackedString(
      tracker.blocked_by_property,
      environment,
    ),
  });
}

function readEnvBackedString(
  value: unknown,
  environment: NodeJS.ProcessEnv,
): string | null {
  return (
    resolveEnvReference(readString(value), environment) ?? readString(value)
  );
}

function readInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }

  return null;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }

  return null;
}

function readPositiveInteger(value: unknown): number | null {
  const parsed = readInteger(value);
  if (parsed === null || parsed <= 0) {
    return null;
  }

  return parsed;
}

function readNonNegativeInteger(value: unknown): number | null {
  const parsed = readInteger(value);
  if (parsed === null || parsed < 0) {
    return null;
  }

  return parsed;
}

function readStringList(value: unknown, fallback: readonly string[]): string[] {
  if (Array.isArray(value)) {
    const items = value.filter(
      (entry): entry is string => typeof entry === "string",
    );
    if (items.length > 0) {
      return items.map((entry) => entry.trim()).filter((entry) => entry !== "");
    }
  }

  if (typeof value === "string") {
    const items = value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "");
    if (items.length > 0) {
      return items;
    }
  }

  return [...fallback];
}

function defaultTrackerEndpoint(trackerKind: string): string {
  return normalizeIssueState(trackerKind) === "notion"
    ? DEFAULT_NOTION_ENDPOINT
    : DEFAULT_LINEAR_ENDPOINT;
}

function defaultTrackerApiKey(
  trackerKind: string,
  environment: NodeJS.ProcessEnv,
): string | null {
  return normalizeIssueState(trackerKind) === "notion"
    ? (environment[NOTION_CANONICAL_API_KEY_ENV] ?? null)
    : (environment[LINEAR_CANONICAL_API_KEY_ENV] ?? null);
}

function readAdapterOption(
  adapterOptions: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = adapterOptions[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function readStateConcurrencyMap(
  value: unknown,
): Readonly<Record<string, number>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_MAX_CONCURRENT_AGENTS_BY_STATE;
  }

  const normalizedEntries = Object.entries(value).flatMap(([state, limit]) => {
    const parsedLimit = readPositiveInteger(limit);
    if (parsedLimit === null) {
      return [];
    }

    return [[normalizeIssueState(state), parsedLimit] as const];
  });

  return Object.freeze(Object.fromEntries(normalizedEntries));
}

function resolveEnvReference(
  value: string | null,
  environment: NodeJS.ProcessEnv,
): string | null {
  if (!value) {
    return null;
  }

  if (!value.startsWith("$")) {
    return value;
  }

  const envName = value.slice(1);
  const resolvedValue = environment[envName];
  if (!resolvedValue || resolvedValue.trim() === "") {
    return null;
  }

  return resolvedValue;
}

function resolvePathValue(
  value: string | null,
  workflowPath: string,
  environment: NodeJS.ProcessEnv,
): string | null {
  const rawPath = resolveEnvReference(value, environment);
  if (!rawPath) {
    return null;
  }

  let expanded = rawPath.startsWith("~")
    ? `${homedir()}${rawPath.slice(1)}`
    : rawPath;

  if (
    !expanded.includes(sep) &&
    !expanded.includes("/") &&
    !expanded.includes("\\")
  ) {
    return expanded;
  }

  if (isAbsolute(expanded)) {
    return normalize(expanded);
  }

  expanded = resolve(resolve(workflowPath, ".."), expanded);
  return normalize(expanded);
}

export const LINEAR_DEFAULTS = Object.freeze({
  endpoint: DEFAULT_LINEAR_ENDPOINT,
  pageSize: DEFAULT_LINEAR_PAGE_SIZE,
  networkTimeoutMs: DEFAULT_LINEAR_NETWORK_TIMEOUT_MS,
});
