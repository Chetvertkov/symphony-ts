import type { CodexDynamicTool } from "../codex/app-server-client.js";
import type { Issue } from "../domain/model.js";
import { ERROR_CODES } from "../errors/codes.js";
import { TrackerError } from "../tracker/errors.js";
import type {
  BlockCapableIssueTracker,
  TrackerBlockerMetadata,
  TrackerBlockerRunResult,
  TrackerLifecycleConfig,
} from "../tracker/tracker.js";

export interface SymphonyBlockToolOptions {
  issue: Issue;
  lifecycle: TrackerLifecycleConfig;
  tracker: BlockCapableIssueTracker;
  onBlock: (result: TrackerBlockerRunResult) => void;
}

export function createSymphonyBlockDynamicTool(
  options: SymphonyBlockToolOptions,
): CodexDynamicTool {
  return {
    name: "symphony_block",
    description:
      "Post clarification questions to the current tracker ticket, move it to the configured blocked state, and stop automatic continuation.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: ["string", "null"],
          description:
            "Short comment title. Defaults to 'Blocked: clarification needed'.",
        },
        questions: {
          type: "array",
          items: {
            type: "string",
          },
          description:
            "Specific clarification questions that must be answered before implementation is safe.",
        },
        details: {
          type: ["string", "null"],
          description:
            "Short explanation of why the task is not implementation-ready.",
        },
      },
      required: ["questions"],
      additionalProperties: true,
    },
    async execute(input) {
      const metadata = parseBlockerMetadata(input);
      try {
        const result = await options.tracker.blockIssue({
          issue: options.issue,
          lifecycle: options.lifecycle,
          metadata,
        });
        options.onBlock({
          status: "succeeded",
          result,
          metadata,
        });
        return {
          success: true,
          issue_id: result.issue.id,
          issue_identifier: result.issue.identifier,
          state: result.state,
          continuation: "suppressed",
        };
      } catch (error) {
        const message = toErrorMessage(error);
        options.onBlock({
          status: "failed",
          error: message,
          metadata,
        });
        throw error;
      }
    },
  };
}

function parseBlockerMetadata(input: unknown): TrackerBlockerMetadata {
  const record = toRecord(input);
  const questions = readStringList(record.questions, record.question);

  if (questions.length === 0) {
    throw new TrackerError(
      ERROR_CODES.configInvalid,
      "symphony_block requires at least one clarification question.",
    );
  }

  return {
    title: readOptionalString(record.title),
    questions,
    details: readOptionalString(record.details, record.summary, record.reason),
  };
}

function toRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  return input as Record<string, unknown>;
}

function readStringList(...values: unknown[]): string[] {
  for (const value of values) {
    if (Array.isArray(value)) {
      const items = value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== "");
      if (items.length > 0) {
        return items;
      }
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed !== "") {
        return [trimmed];
      }
    }
  }

  return [];
}

function readOptionalString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const trimmed = value.trim();
    if (trimmed !== "") {
      return trimmed;
    }
  }

  return null;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "tracker block failed";
}
