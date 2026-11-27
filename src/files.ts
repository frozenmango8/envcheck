import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { checkSources } from "./check.js";
import { finalize } from "./result.js";
import type { CheckOptions, CheckResult, FileError } from "./types.js";

export interface CheckFilesOptions extends CheckOptions {
  envPath: string;
  examplePath: string;
  /** Resolved against relative paths. Defaults to `process.cwd()`. */
  cwd?: string;
}

export function checkFiles(options: CheckFilesOptions): CheckResult {
  const cwd = options.cwd ?? process.cwd();
  const shared = {
    envPath: options.envPath,
    examplePath: options.examplePath,
    strict: options.strict ?? false,
    allowEmpty: options.allowEmpty ?? false,
    ignore: options.ignore ?? [],
  };

  const env = readEnvFile(resolve(cwd, options.envPath));
  if (!env.ok) {
    return finalize({
      ...shared,
      issues: [],
      keys: { env: 0, example: 0 },
      error: fileError("env", options.envPath, env.reason, env.detail),
    });
  }

  const example = readEnvFile(resolve(cwd, options.examplePath));
  if (!example.ok) {
    return finalize({
      ...shared,
      issues: [],
      keys: { env: 0, example: 0 },
      error: fileError("example", options.examplePath, example.reason, example.detail),
    });
  }

  return checkSources(
    {
      env: { path: options.envPath, content: env.content },
      example: { path: options.examplePath, content: example.content },
    },
    options,
  );
}

type ReadResult =
  | { ok: true; content: string }
  | { ok: false; reason: "enoent" | "eisdir" | "eacces" | "other"; detail?: string };

function readEnvFile(path: string): ReadResult {
  try {
    return { ok: true, content: readFileSync(path, "utf8") };
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT") return { ok: false, reason: "enoent" };
    if (code === "EISDIR") return { ok: false, reason: "eisdir" };
    if (code === "EACCES" || code === "EPERM") return { ok: false, reason: "eacces" };
    return { ok: false, reason: "other", detail: code ?? errorMessage(error) };
  }
}

function fileError(
  kind: "env" | "example",
  path: string,
  reason: "enoent" | "eisdir" | "eacces" | "other",
  detail?: string,
): FileError {
  const flag = kind === "env" ? "--env <path>" : "--example <path>";
  if (reason === "enoent") {
    return {
      code: "not_found",
      path,
      message: `no such file: ${path}. Create it, or pass ${flag}.`,
    };
  }
  if (reason === "eisdir") {
    return { code: "unreadable", path, message: `${path} is a directory. Pass ${flag}.` };
  }
  if (reason === "eacces") {
    return { code: "unreadable", path, message: `permission denied reading ${path}.` };
  }
  const suffix = detail ? `: ${detail}` : "";
  return { code: "unreadable", path, message: `cannot read ${path}${suffix}.` };
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
