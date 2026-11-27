import type { CheckResult, Counts, FileError, Issue } from "./types.js";

export function emptyCounts(): Counts {
  return {
    error: 0,
    warning: 0,
    missing: 0,
    empty: 0,
    extra: 0,
    duplicate: 0,
    parse: 0,
  };
}

export function countsFrom(issues: readonly Issue[]): Counts {
  const counts = emptyCounts();
  for (const issue of issues) {
    if (issue.severity === "error") counts.error += 1;
    else counts.warning += 1;
    counts[issue.code] += 1;
  }
  return counts;
}

export function normalizeIgnore(keys: readonly string[] | undefined): string[] {
  const ignore: string[] = [];
  const seen = new Set<string>();
  for (const entry of keys ?? []) {
    for (const part of entry.split(",")) {
      const key = part.trim();
      if (key.length === 0 || seen.has(key)) continue;
      seen.add(key);
      ignore.push(key);
    }
  }
  return ignore;
}

export function finalize(input: {
  envPath: string;
  examplePath: string;
  strict: boolean;
  allowEmpty: boolean;
  ignore: readonly string[];
  issues: Issue[];
  keys: { env: number; example: number };
  error?: FileError;
}): CheckResult {
  const issues = input.issues;
  const error = input.error;
  const exitCode: 0 | 1 | 2 = error
    ? 2
    : issues.some((issue) => issue.code === "parse")
      ? 2
      : issues.some((issue) => issue.severity === "error")
        ? 1
        : 0;

  const result: CheckResult = {
    ok: exitCode === 0,
    exitCode,
    envPath: input.envPath,
    examplePath: input.examplePath,
    strict: input.strict,
    allowEmpty: input.allowEmpty,
    ignore: normalizeIgnore(input.ignore),
    keys: input.keys,
    counts: countsFrom(issues),
    issues,
  };
  if (error) result.error = error;
  return result;
}
