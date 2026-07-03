import type { CodexDynamicTool } from "../codex/app-server-client.js";
import type { Issue } from "../domain/model.js";
import { ERROR_CODES } from "../errors/codes.js";
import { TrackerError } from "../tracker/errors.js";
import type {
  IssueContextCapableIssueTracker,
  IssueNoteCapableIssueTracker,
  TrackerIssueNoteMetadata,
} from "../tracker/tracker.js";

export interface SymphonyTicketReadToolOptions {
  issue: Issue;
  tracker: IssueContextCapableIssueTracker;
}

export interface SymphonyTicketNoteToolOptions {
  issue: Issue;
  tracker: IssueNoteCapableIssueTracker;
}

export function createSymphonyTicketReadDynamicTool(
  options: SymphonyTicketReadToolOptions,
): CodexDynamicTool {
  return {
    name: "symphony_ticket_read",
    description:
      "Read the current tracker ticket body and comments through Symphony's tracker credentials.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: true,
    },
    async execute() {
      const context = await options.tracker.readIssueContext({
        issue: options.issue,
      });
      return {
        success: true,
        issue: {
          id: context.issue.id,
          identifier: context.issue.identifier,
          title: options.issue.title,
          state: context.issue.state,
          description: options.issue.description,
          url: options.issue.url,
        },
        entries: context.entries,
        unavailable_sources: context.unavailableSources,
      };
    },
  };
}

export function createSymphonyTicketNoteDynamicTool(
  options: SymphonyTicketNoteToolOptions,
): CodexDynamicTool {
  return {
    name: "symphony_ticket_note",
    description:
      "Append a checkpoint, question, or implementation note to the current tracker ticket.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: ["string", "null"],
          description: "Optional short heading for the ticket note.",
        },
        body: {
          type: "string",
          description:
            "Markdown/plain-text note body to append to the tracker ticket.",
        },
      },
      required: ["body"],
      additionalProperties: true,
    },
    async execute(input) {
      const metadata = parseIssueNoteMetadata(input);
      const result = await options.tracker.appendIssueNote({
        issue: options.issue,
        metadata,
      });
      return {
        success: true,
        issue_id: result.issue.id,
        issue_identifier: result.issue.identifier,
        state: result.issue.state,
        destination: result.destination,
      };
    },
  };
}

function parseIssueNoteMetadata(input: unknown): TrackerIssueNoteMetadata {
  const record = toRecord(input);
  const body = readOptionalString(record.body, record.text, record.note);

  if (body === null) {
    throw new TrackerError(
      ERROR_CODES.configInvalid,
      "symphony_ticket_note requires a non-empty body.",
    );
  }

  return {
    title: readOptionalString(record.title),
    body,
  };
}

function toRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  return input as Record<string, unknown>;
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
