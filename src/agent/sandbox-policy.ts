import { join } from "node:path";

type JsonArray = JsonValue[];
type JsonObject = { [key: string]: JsonValue };
type JsonValue = JsonObject | JsonArray | string | number | boolean | null;

export function prepareTurnSandboxPolicy(
  policy: unknown,
  workspacePath: string,
): unknown {
  if (!isRecord(policy)) {
    return policy;
  }

  const prepared = replaceWorkspacePlaceholders(
    policy as JsonObject,
    workspacePath,
  );
  if (!isRecord(prepared)) {
    return prepared;
  }

  const type = typeof prepared.type === "string" ? prepared.type : null;
  if (type !== "workspaceWrite" && type !== "workspace-write") {
    return prepared;
  }

  const existingRoots = Array.isArray(prepared.writableRoots)
    ? prepared.writableRoots.filter(
        (entry): entry is string => typeof entry === "string",
      )
    : [];
  const writableRoots = dedupe([
    ...existingRoots,
    workspacePath,
    join(workspacePath, ".git"),
  ]);

  return {
    ...prepared,
    type: "workspaceWrite",
    writableRoots,
  };
}

function replaceWorkspacePlaceholders(
  value: JsonValue,
  workspacePath: string,
): JsonValue {
  if (typeof value === "string") {
    return value
      .replaceAll("{{workspace.path}}", workspacePath)
      .replaceAll("{{ workspace.path }}", workspacePath)
      .replaceAll("{{workspace.git_dir}}", join(workspacePath, ".git"))
      .replaceAll("{{ workspace.git_dir }}", join(workspacePath, ".git"));
  }

  if (Array.isArray(value)) {
    return value.map((entry) =>
      replaceWorkspacePlaceholders(entry, workspacePath),
    );
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        replaceWorkspacePlaceholders(entry, workspacePath),
      ]),
    );
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (value.trim() === "" || seen.has(value)) {
      continue;
    }

    seen.add(value);
    result.push(value);
  }

  return result;
}
