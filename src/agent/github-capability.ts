import type {
  CodexCommandExecInput,
  CodexCommandExecResult,
} from "../codex/app-server-client.js";
import { ERROR_CODES } from "../errors/codes.js";

const CAPABILITY = "github";
const DEFAULT_GITHUB_CAPABILITY_PROBE_TIMEOUT_MS = 15_000;
const WINDOWS_GITHUB_CAPABILITY_PROBE_TIMEOUT_MS = 60_000;

export function resolveGithubCapabilityProbeTimeoutMs(
  platform: NodeJS.Platform,
): number {
  return platform === "win32"
    ? WINDOWS_GITHUB_CAPABILITY_PROBE_TIMEOUT_MS
    : DEFAULT_GITHUB_CAPABILITY_PROBE_TIMEOUT_MS;
}

export const GITHUB_CAPABILITY_PROBE_TIMEOUT_MS =
  resolveGithubCapabilityProbeTimeoutMs(process.platform);
export const GITHUB_CAPABILITY_OUTPUT_BYTES_CAP = 64 * 1024;

export interface CapabilityCommandExecutor {
  execCommand(input: CodexCommandExecInput): Promise<CodexCommandExecResult>;
}

export interface GithubCapabilityProbeInput {
  workspacePath: string;
  sandboxPolicy: unknown;
  executor: CapabilityCommandExecutor;
}

export interface GithubCapabilityProbeResult {
  identity: string;
  repository: string;
  canPush: true;
}

export interface GithubCapabilityProbe {
  probe(
    input: GithubCapabilityProbeInput,
  ): Promise<GithubCapabilityProbeResult>;
}

export interface GhGithubCapabilityProbeOptions {
  platform?: NodeJS.Platform;
}

export class GithubCapabilityError extends Error {
  readonly code: string;
  readonly capability = CAPABILITY;
  readonly deterministic: boolean;

  constructor(input: {
    code: string;
    message: string;
    deterministic: boolean;
  }) {
    super(input.message);
    this.name = "GithubCapabilityError";
    this.code = input.code;
    this.deterministic = input.deterministic;
  }
}

export class GhGithubCapabilityProbe implements GithubCapabilityProbe {
  private readonly timeoutMs: number;

  constructor(options: GhGithubCapabilityProbeOptions = {}) {
    this.timeoutMs = resolveGithubCapabilityProbeTimeoutMs(
      options.platform ?? process.platform,
    );
  }

  async probe(
    input: GithubCapabilityProbeInput,
  ): Promise<GithubCapabilityProbeResult> {
    const identityResult = await this.runGh(input, [
      "api",
      "user",
      "--jq",
      ".login",
    ]);
    assertCommandSucceeded(identityResult);
    const identity = identityResult.stdout.trim();
    if (identity.length === 0) {
      throw transientFailure();
    }

    const repositoryResult = await this.runGh(input, [
      "repo",
      "view",
      "--json",
      "nameWithOwner",
      "--jq",
      ".nameWithOwner",
    ]);
    assertCommandSucceeded(repositoryResult);
    const repository = repositoryResult.stdout.trim();
    if (!isRepositoryNameWithOwner(repository)) {
      throw transientFailure();
    }

    const permissionResult = await this.runGh(input, [
      "api",
      `repos/${repository}`,
      "--jq",
      ".permissions.push",
    ]);
    assertCommandSucceeded(permissionResult);
    const canPush = permissionResult.stdout.trim().toLowerCase();
    if (canPush === "false") {
      throw permissionFailure();
    }
    if (canPush !== "true") {
      throw transientFailure();
    }

    return {
      identity,
      repository,
      canPush: true,
    };
  }

  private async runGh(
    input: GithubCapabilityProbeInput,
    args: string[],
  ): Promise<CodexCommandExecResult> {
    try {
      return await input.executor.execCommand({
        command: ["gh", ...args],
        cwd: input.workspacePath,
        timeoutMs: this.timeoutMs,
        ...(process.platform === "win32"
          ? {}
          : { outputBytesCap: GITHUB_CAPABILITY_OUTPUT_BYTES_CAP }),
        sandboxPolicy: input.sandboxPolicy,
      });
    } catch (error) {
      if (isMissingExecutableError(error)) {
        throw missingExecutableFailure();
      }
      throw transientFailure();
    }
  }
}

export function isDeterministicGithubCapabilityErrorCode(
  code: string | undefined,
): code is
  | typeof ERROR_CODES.githubCliNotFound
  | typeof ERROR_CODES.githubAuthInvalid
  | typeof ERROR_CODES.githubPermissionDenied {
  return (
    code === ERROR_CODES.githubCliNotFound ||
    code === ERROR_CODES.githubAuthInvalid ||
    code === ERROR_CODES.githubPermissionDenied
  );
}

export function isGithubCapabilityErrorCode(
  code: string | undefined,
): code is
  | typeof ERROR_CODES.githubCliNotFound
  | typeof ERROR_CODES.githubAuthInvalid
  | typeof ERROR_CODES.githubPermissionDenied
  | typeof ERROR_CODES.githubCapabilityTransient {
  return (
    isDeterministicGithubCapabilityErrorCode(code) ||
    code === ERROR_CODES.githubCapabilityTransient
  );
}

function assertCommandSucceeded(result: CodexCommandExecResult): void {
  if (result.exitCode === 0) {
    return;
  }

  throw classifyCommandFailure(result);
}

function classifyCommandFailure(
  result: CodexCommandExecResult,
): GithubCapabilityError {
  if (
    result.exitCode === 127 ||
    /command not found|not recognized as an internal or external command|no such file or directory/i.test(
      result.stderr,
    )
  ) {
    return missingExecutableFailure();
  }

  const diagnostic = `${result.stdout}\n${result.stderr}`;
  if (
    /\bHTTP\s+401\b|\bstatus(?: code)?\s*401\b|bad credentials|not logged in|not authenticated|authentication failed|requires authentication|gh auth login/i.test(
      diagnostic,
    )
  ) {
    return new GithubCapabilityError({
      code: ERROR_CODES.githubAuthInvalid,
      message:
        "Required GitHub capability failed: gh authentication is invalid or expired.",
      deterministic: true,
    });
  }

  if (
    /\bHTTP\s+403\b|\bstatus(?: code)?\s*403\b|forbidden|permission denied/i.test(
      diagnostic,
    )
  ) {
    return permissionFailure();
  }

  return transientFailure();
}

function isMissingExecutableError(error: unknown): boolean {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : null;
  if (code === "ENOENT") {
    return true;
  }

  return (
    error instanceof Error &&
    /executable.*not found|no such file or directory/i.test(error.message)
  );
}

function missingExecutableFailure(): GithubCapabilityError {
  return new GithubCapabilityError({
    code: ERROR_CODES.githubCliNotFound,
    message:
      "Required GitHub capability is unavailable: gh was not found in the Codex command environment.",
    deterministic: true,
  });
}

function permissionFailure(): GithubCapabilityError {
  return new GithubCapabilityError({
    code: ERROR_CODES.githubPermissionDenied,
    message:
      "Required GitHub capability failed: the authenticated identity cannot push to the workspace target repository.",
    deterministic: true,
  });
}

function transientFailure(): GithubCapabilityError {
  return new GithubCapabilityError({
    code: ERROR_CODES.githubCapabilityTransient,
    message:
      "Required GitHub capability could not be verified due to a transient GitHub CLI or network failure.",
    deterministic: false,
  });
}

function isRepositoryNameWithOwner(value: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
}
