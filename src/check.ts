import { parseEnv } from "./parse.js";
import { finalize, normalizeIgnore } from "./result.js";
import type { CheckOptions, CheckResult, DuplicateKey, Issue, ParseIssue } from "./types.js";

const CODE_RANK: Record<Issue["code"], number> = {
  parse: 0,
  duplicate: 1,
  missing: 2,
  empty: 3,
  extra: 4,
};

export interface SourceFile {
  /** Path printed in messages. Not required to exist on disk. */
  path: string;
  content: string;
}

export interface CheckSourcesInput {
  env: SourceFile;
  example: SourceFile;
}

/**
 * Compare two env documents. Values are used only to decide emptiness and are
 * never copied into issues.
 */
export function checkSources(input: CheckSourcesInput, options: CheckOptions = {}): CheckResult {
  const strict = options.strict ?? false;
  const allowEmpty = options.allowEmpty ?? false;
  const ignore = normalizeIgnore(options.ignore);
  const ignored = new Set(ignore);

  const example = parseEnv(input.example.content);
  const env = parseEnv(input.env.content);
  const issues: Issue[] = [];

  pushParseIssues(issues, example.issues, input.example.path);
  pushParseIssues(issues, env.issues, input.env.path);
  pushDuplicates(issues, example.duplicates, input.example.path, ignored);
  pushDuplicates(issues, env.duplicates, input.env.path, ignored);

  const brokenEnv = keysWithParseIssues(env.issues);
  const brokenExample = keysWithParseIssues(example.issues);

  for (const [key, binding] of example.values) {
    if (ignored.has(key)) continue;
    const actual = env.values.get(key);
    if (!actual) {
      if (binding.optional || brokenEnv.has(key)) continue;
      issues.push({
        code: "missing",
        severity: "error",
        key,
        file: input.example.path,
        line: binding.line,
        message: `required in ${input.example.path}:${binding.line}, missing from ${input.env.path}`,
      });
      continue;
    }

    if (!allowEmpty && !binding.optional && isBlank(actual.value) && !isBlank(binding.value)) {
      issues.push({
        code: "empty",
        severity: "error",
        key,
        file: input.env.path,
        line: actual.line,
        message: `empty in ${input.env.path}:${actual.line}; ${input.example.path}:${binding.line} expects a value`,
      });
    }
  }

  for (const [key, binding] of env.values) {
    if (ignored.has(key) || example.values.has(key) || brokenExample.has(key)) continue;
    issues.push({
      code: "extra",
      severity: strict ? "error" : "warning",
      key,
      file: input.env.path,
      line: binding.line,
      message: `in ${input.env.path}:${binding.line}, not in ${input.example.path}`,
    });
  }

  const examplePath = input.example.path;
  const envPath = input.env.path;
  issues.sort((a, b) => {
    const byCode = CODE_RANK[a.code] - CODE_RANK[b.code];
    if (byCode !== 0) return byCode;
    const byFile = fileRank(a.file, examplePath, envPath) - fileRank(b.file, examplePath, envPath);
    if (byFile !== 0) return byFile;
    const byLine = (a.line ?? 0) - (b.line ?? 0);
    if (byLine !== 0) return byLine;
    return (a.key ?? "").localeCompare(b.key ?? "");
  });

  return finalize({
    envPath,
    examplePath,
    strict,
    allowEmpty,
    ignore,
    issues,
    keys: { env: env.values.size, example: example.values.size },
  });
}

function pushParseIssues(issues: Issue[], parseIssues: readonly ParseIssue[], file: string): void {
  for (const issue of parseIssues) {
    issues.push({
      code: "parse",
      severity: "error",
      message: issue.message,
      file,
      line: issue.line,
      ...(issue.key !== undefined ? { key: issue.key } : {}),
    });
  }
}

function pushDuplicates(
  issues: Issue[],
  duplicates: readonly DuplicateKey[],
  file: string,
  ignored: ReadonlySet<string>,
): void {
  for (const duplicate of duplicates) {
    if (ignored.has(duplicate.key)) continue;
    const times = duplicate.lines.length === 2 ? "twice" : `${duplicate.lines.length} times`;
    issues.push({
      code: "duplicate",
      severity: "error",
      key: duplicate.key,
      file,
      line: duplicate.lines[0],
      lines: duplicate.lines,
      message: `defined ${times} in ${file} (${formatLineList(duplicate.lines)}); last value wins`,
    });
  }
}

function keysWithParseIssues(issues: readonly ParseIssue[]): Set<string> {
  const keys = new Set<string>();
  for (const issue of issues) {
    if (issue.key !== undefined) keys.add(issue.key);
  }
  return keys;
}

function fileRank(file: string | undefined, examplePath: string, envPath: string): number {
  if (file === examplePath) return 0;
  if (file === envPath) return 1;
  return 2;
}

function formatLineList(lines: readonly number[]): string {
  if (lines.length === 0) return "lines";
  if (lines.length === 1) return `line ${lines[0]}`;
  if (lines.length === 2) return `lines ${lines[0]} and ${lines[1]}`;
  const head = lines.slice(0, -1).join(", ");
  return `lines ${head}, and ${lines[lines.length - 1]}`;
}

function isBlank(value: string): boolean {
  return value.trim() === "";
}
