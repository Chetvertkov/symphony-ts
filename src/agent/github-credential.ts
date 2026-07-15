import { execFile } from "node:child_process";

import { ERROR_CODES } from "../errors/codes.js";
import {
  GITHUB_CAPABILITY_OUTPUT_BYTES_CAP,
  GithubCapabilityError,
} from "./github-capability.js";

const GITHUB_HOSTNAME = "github.com";
export const GITHUB_CREDENTIAL_LOAD_TIMEOUT_MS = 15_000;

export interface GithubCredentialProviderInput {
  environment: NodeJS.ProcessEnv;
}

export interface GithubCredentialProvider {
  getToken(input: GithubCredentialProviderInput): Promise<string>;
}

export interface GithubCredentialCommandInput {
  executable: string;
  args: readonly string[];
  environment: NodeJS.ProcessEnv;
  timeoutMs: number;
  outputBytesCap: number;
}

export interface GithubCredentialCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  errorCode: string | null;
}

export interface GithubCredentialCommandRunner {
  execFile(
    input: GithubCredentialCommandInput,
  ): Promise<GithubCredentialCommandResult>;
}

export class GhAuthTokenCredentialProvider implements GithubCredentialProvider {
  private readonly commandRunner: GithubCredentialCommandRunner;

  constructor(
    commandRunner: GithubCredentialCommandRunner = new NodeGithubCredentialCommandRunner(),
  ) {
    this.commandRunner = commandRunner;
  }

  async getToken(input: GithubCredentialProviderInput): Promise<string> {
    let result: GithubCredentialCommandResult;
    try {
      result = await this.commandRunner.execFile({
        executable: "gh",
        args: ["auth", "token", "--hostname", GITHUB_HOSTNAME],
        environment: input.environment,
        timeoutMs: GITHUB_CREDENTIAL_LOAD_TIMEOUT_MS,
        outputBytesCap: GITHUB_CAPABILITY_OUTPUT_BYTES_CAP,
      });
    } catch (error) {
      if (isMissingExecutableError(error)) {
        throw launchEnvironmentMissingExecutableFailure();
      }
      throw credentialLoadTransientFailure();
    }

    if (result.exitCode !== 0) {
      if (result.errorCode === "ENOENT") {
        throw launchEnvironmentMissingExecutableFailure();
      }
      if (isAuthenticationDiagnostic(result.stderr)) {
        throw authenticationFailure();
      }
      throw credentialLoadTransientFailure();
    }

    const token = result.stdout.trim();
    if (token.length === 0) {
      throw authenticationFailure();
    }

    return token;
  }
}

class NodeGithubCredentialCommandRunner
  implements GithubCredentialCommandRunner
{
  async execFile(
    input: GithubCredentialCommandInput,
  ): Promise<GithubCredentialCommandResult> {
    return await new Promise((resolve) => {
      execFile(
        input.executable,
        [...input.args],
        {
          encoding: "utf8",
          env: input.environment,
          maxBuffer: input.outputBytesCap,
          shell: false,
          timeout: input.timeoutMs,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          resolve({
            exitCode:
              error === null
                ? 0
                : typeof error.code === "number"
                  ? error.code
                  : null,
            stdout,
            stderr,
            errorCode:
              error !== null && typeof error.code === "string"
                ? error.code
                : null,
          });
        },
      );
    });
  }
}

function isAuthenticationDiagnostic(diagnostic: string): boolean {
  return /not logged in|not logged into any github hosts|no (?:oauth|authentication) token|authentication failed|gh auth login/i.test(
    diagnostic,
  );
}

function isMissingExecutableError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function launchEnvironmentMissingExecutableFailure(): GithubCapabilityError {
  return new GithubCapabilityError({
    code: ERROR_CODES.githubCliNotFound,
    message:
      "Required GitHub capability is unavailable: gh was not found in the Symphony launch environment.",
    deterministic: true,
  });
}

function authenticationFailure(): GithubCapabilityError {
  return new GithubCapabilityError({
    code: ERROR_CODES.githubAuthInvalid,
    message:
      "Required GitHub capability failed: gh authentication is invalid or expired.",
    deterministic: true,
  });
}

function credentialLoadTransientFailure(): GithubCapabilityError {
  return new GithubCapabilityError({
    code: ERROR_CODES.githubCapabilityTransient,
    message:
      "Required GitHub credential could not be loaded from gh auth token due to a transient local CLI failure.",
    deterministic: false,
  });
}
