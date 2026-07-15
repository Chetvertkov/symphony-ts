import { describe, expect, it, vi } from "vitest";

import {
  GITHUB_CAPABILITY_OUTPUT_BYTES_CAP,
  GITHUB_CAPABILITY_PROBE_TIMEOUT_MS,
} from "../../src/agent/github-capability.js";
import { ERROR_CODES } from "../../src/errors/codes.js";
import {
  GhAuthTokenCredentialProvider,
  type GithubCapabilityError,
  type GithubCredentialCommandResult,
} from "../../src/index.js";

describe("GhAuthTokenCredentialProvider", () => {
  it("loads the current github.com token through a bounded direct gh argv call", async () => {
    const environment = {
      PATH: "C:\\tools",
      GH_CONFIG_DIR: "C:\\gh-config",
    };
    const execFile = vi.fn().mockResolvedValue(result(0, "keyring-token\n"));
    const provider = new GhAuthTokenCredentialProvider({ execFile });

    await expect(provider.getToken({ environment })).resolves.toBe(
      "keyring-token",
    );

    expect(execFile).toHaveBeenCalledWith({
      executable: "gh",
      args: ["auth", "token", "--hostname", "github.com"],
      environment,
      timeoutMs: GITHUB_CAPABILITY_PROBE_TIMEOUT_MS,
      outputBytesCap: GITHUB_CAPABILITY_OUTPUT_BYTES_CAP,
    });
  });

  it.each([
    {
      label: "missing gh",
      response: result(null, "", "", "ENOENT"),
      code: ERROR_CODES.githubCliNotFound,
      deterministic: true,
    },
    {
      label: "missing login",
      response: result(
        1,
        "",
        "not logged into any GitHub hosts token=secret-value",
      ),
      code: ERROR_CODES.githubAuthInvalid,
      deterministic: true,
    },
    {
      label: "empty successful output",
      response: result(0, ""),
      code: ERROR_CODES.githubAuthInvalid,
      deterministic: true,
    },
    {
      label: "unclassified local failure",
      response: result(1, "", "keyring failed token=secret-value"),
      code: ERROR_CODES.githubCapabilityTransient,
      deterministic: false,
    },
  ])("classifies and redacts $label", async (input) => {
    const provider = new GhAuthTokenCredentialProvider({
      execFile: vi.fn().mockResolvedValue(input.response),
    });

    const error = await captureError(provider.getToken({ environment: {} }));

    expect(error).toMatchObject({
      name: "GithubCapabilityError",
      code: input.code,
      capability: "github",
      deterministic: input.deterministic,
    } satisfies Partial<GithubCapabilityError>);
    expect(error.message).not.toContain("secret-value");
    expect(error.message).not.toContain("token=");
  });

  it("redacts unexpected command-runner exceptions", async () => {
    const provider = new GhAuthTokenCredentialProvider({
      execFile: vi
        .fn()
        .mockRejectedValue(new Error("spawn failed token=secret-value")),
    });

    const error = await captureError(provider.getToken({ environment: {} }));

    expect(error.code).toBe(ERROR_CODES.githubCapabilityTransient);
    expect(error.message).not.toContain("secret-value");
  });
});

function result(
  exitCode: number | null,
  stdout: string,
  stderr = "",
  errorCode: string | null = null,
): GithubCredentialCommandResult {
  return {
    exitCode,
    stdout,
    stderr,
    errorCode,
  };
}

async function captureError(
  promise: Promise<unknown>,
): Promise<GithubCapabilityError> {
  try {
    await promise;
    throw new Error("Expected promise to reject.");
  } catch (error) {
    return error as GithubCapabilityError;
  }
}
