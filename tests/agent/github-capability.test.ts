import { describe, expect, it, vi } from "vitest";

import {
  GITHUB_CAPABILITY_OUTPUT_BYTES_CAP,
  GhGithubCapabilityProbe,
  type GithubCapabilityError,
  resolveGithubCapabilityProbeTimeoutMs,
} from "../../src/agent/github-capability.js";
import type { CodexCommandExecResult } from "../../src/codex/app-server-client.js";
import { ERROR_CODES } from "../../src/errors/codes.js";

const WORKSPACE = "C:\\workspaces\\ABC-123";
const SANDBOX_POLICY = {
  type: "workspaceWrite",
  writableRoots: [WORKSPACE, `${WORKSPACE}\\.git`],
};

describe("GhGithubCapabilityProbe", () => {
  it("allows for Windows command/exec sandbox startup overhead", () => {
    expect(resolveGithubCapabilityProbeTimeoutMs("win32")).toBe(60_000);
    expect(resolveGithubCapabilityProbeTimeoutMs("linux")).toBe(15_000);
    expect(resolveGithubCapabilityProbeTimeoutMs("darwin")).toBe(15_000);
  });

  it("checks identity, target repository, and push permission with non-mutating argv commands", async () => {
    const execCommand = vi
      .fn()
      .mockResolvedValueOnce(result("octocat\n"))
      .mockResolvedValueOnce(result("example/project\n"))
      .mockResolvedValueOnce(result("true\n"));
    const probe = new GhGithubCapabilityProbe({ platform: "win32" });

    await expect(
      probe.probe({
        workspacePath: WORKSPACE,
        sandboxPolicy: SANDBOX_POLICY,
        executor: { execCommand },
      }),
    ).resolves.toEqual({
      identity: "octocat",
      repository: "example/project",
      canPush: true,
    });

    expect(execCommand.mock.calls.map(([input]) => input.command)).toEqual([
      ["gh", "api", "user", "--jq", ".login"],
      [
        "gh",
        "repo",
        "view",
        "--json",
        "nameWithOwner",
        "--jq",
        ".nameWithOwner",
      ],
      ["gh", "api", "repos/example/project", "--jq", ".permissions.push"],
    ]);
    for (const [input] of execCommand.mock.calls) {
      expect(input).toMatchObject({
        cwd: WORKSPACE,
        timeoutMs: 60_000,
        sandboxPolicy: SANDBOX_POLICY,
      });
      if (process.platform === "win32") {
        expect(input).not.toHaveProperty("outputBytesCap");
      } else {
        expect(input.outputBytesCap).toBe(GITHUB_CAPABILITY_OUTPUT_BYTES_CAP);
      }
      expect(input).not.toHaveProperty("env");
    }
  });

  it("keeps the existing command timeout outside Windows", async () => {
    const execCommand = vi
      .fn()
      .mockResolvedValueOnce(result("octocat\n"))
      .mockResolvedValueOnce(result("example/project\n"))
      .mockResolvedValueOnce(result("true\n"));

    await new GhGithubCapabilityProbe({ platform: "linux" }).probe({
      workspacePath: WORKSPACE,
      sandboxPolicy: SANDBOX_POLICY,
      executor: { execCommand },
    });

    expect(execCommand.mock.calls.map(([input]) => input.timeoutMs)).toEqual([
      15_000, 15_000, 15_000,
    ]);
  });

  it("allows Windows probe steps beyond the previous timeout budget", async () => {
    const outputs = ["octocat\n", "example/project\n", "true\n"];
    const simulatedDurationMs = 20_000;
    const execCommand = vi.fn(
      async (input: { timeoutMs: number }): Promise<CodexCommandExecResult> => {
        if (input.timeoutMs <= simulatedDurationMs) {
          throw new Error("simulated command timeout");
        }
        return result(outputs.shift() ?? "");
      },
    );

    await expect(
      new GhGithubCapabilityProbe({ platform: "win32" }).probe({
        workspacePath: WORKSPACE,
        sandboxPolicy: SANDBOX_POLICY,
        executor: { execCommand },
      }),
    ).resolves.toMatchObject({
      identity: "octocat",
      repository: "example/project",
      canPush: true,
    });
    expect(execCommand).toHaveBeenCalledTimes(3);
  });

  it.each([
    {
      label: "missing executable",
      response: result("", "gh: command not found", 127),
      code: ERROR_CODES.githubCliNotFound,
      deterministic: true,
    },
    {
      label: "HTTP 401",
      response: result("", "HTTP 401: Bad credentials token=secret-value", 1),
      code: ERROR_CODES.githubAuthInvalid,
      deterministic: true,
    },
    {
      label: "HTTP 403",
      response: result("", "HTTP 403: Forbidden token=secret-value", 1),
      code: ERROR_CODES.githubPermissionDenied,
      deterministic: true,
    },
    {
      label: "timeout or network failure",
      response: result("", "request timed out token=secret-value", 1),
      code: ERROR_CODES.githubCapabilityTransient,
      deterministic: false,
    },
  ])("classifies and redacts $label", async (input) => {
    const probe = new GhGithubCapabilityProbe();

    const error = await captureError(
      probe.probe({
        workspacePath: WORKSPACE,
        sandboxPolicy: SANDBOX_POLICY,
        executor: {
          execCommand: vi.fn().mockResolvedValue(input.response),
        },
      }),
    );

    expect(error).toMatchObject({
      name: "GithubCapabilityError",
      code: input.code,
      capability: "github",
      deterministic: input.deterministic,
    } satisfies Partial<GithubCapabilityError>);
    expect(error.message).not.toContain("secret-value");
    expect(error.message).not.toContain("token=");
  });

  it("classifies push=false separately from transient failures", async () => {
    const execCommand = vi
      .fn()
      .mockResolvedValueOnce(result("octocat\n"))
      .mockResolvedValueOnce(result("example/project\n"))
      .mockResolvedValueOnce(result("false\n"));

    await expect(
      new GhGithubCapabilityProbe().probe({
        workspacePath: WORKSPACE,
        sandboxPolicy: SANDBOX_POLICY,
        executor: { execCommand },
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.githubPermissionDenied,
      deterministic: true,
    } satisfies Partial<GithubCapabilityError>);
  });

  it("redacts executor failures and classifies them as transient", async () => {
    const error = await captureError(
      new GhGithubCapabilityProbe().probe({
        workspacePath: WORKSPACE,
        sandboxPolicy: SANDBOX_POLICY,
        executor: {
          execCommand: vi
            .fn()
            .mockRejectedValue(new Error("socket failed token=secret-value")),
        },
      }),
    );

    expect(error.code).toBe(ERROR_CODES.githubCapabilityTransient);
    expect(error.message).not.toContain("secret-value");
  });
});

function result(
  stdout: string,
  stderr = "",
  exitCode = 0,
): CodexCommandExecResult {
  return { exitCode, stdout, stderr };
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
