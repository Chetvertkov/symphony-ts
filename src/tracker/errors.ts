import { ERROR_CODES, type ErrorCode } from "../errors/codes.js";

export interface TrackerErrorOptions {
  cause?: unknown;
  details?: unknown;
  status?: number;
}

export class TrackerError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown;
  readonly status: number | null;

  constructor(
    code: ErrorCode,
    message: string,
    options: TrackerErrorOptions = {},
  ) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "TrackerError";
    this.code = code;
    this.details = options.details ?? null;
    this.status = options.status ?? null;
  }
}

export function toTrackerRequestError(error: unknown): TrackerError {
  return toTrackerRequestErrorWithCode(
    error,
    ERROR_CODES.linearApiRequest,
    "Linear request failed before a valid response was received.",
  );
}

export function toTrackerRequestErrorWithCode(
  error: unknown,
  code: ErrorCode,
  message: string,
): TrackerError {
  if (error instanceof TrackerError) {
    return error;
  }

  return new TrackerError(code, message, { cause: error });
}
