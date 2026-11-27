import type { CheckResult, Issue } from "./types.js";

const CODE_WIDTH = 9;
const INDENT = 2 + CODE_WIDTH + 1;

export interface FormatOptions {
  color?: boolean;
}

/** Human report. File and usage errors are a single line. Values are never included. */
export function formatHuman(result: CheckResult, options: FormatOptions = {}): string {
  const paint = palette(options.color ?? false);

  if (result.error) {
    return `${paint.red("envcheck")}: ${result.error.message}\n`;
  }

  if (result.issues.length === 0) {
    const count = result.keys.example;
    const noun = count === 1 ? "key" : "keys";
    const mode = result.strict ? ", strict" : "";
    const line = `✓ ${result.envPath} matches ${result.examplePath} (${count} ${noun}${mode})`;
    return `${paint.green(line)}\n`;
  }

  const blocks = result.issues.map((issue) => formatIssue(issue, paint));
  const header = `${paint.bold("envcheck")}: ${result.envPath} vs ${result.examplePath}`;
  return `${header}\n\n${blocks.join("\n\n")}\n\n${paintSummary(result, paint)}\n`;
}

/** Stable, pretty-printed JSON report. Values are never included. */
export function formatJson(result: CheckResult): string {
  const body: Record<string, unknown> = {
    ok: result.ok,
    exitCode: result.exitCode,
    env: result.envPath,
    example: result.examplePath,
    strict: result.strict,
    allowEmpty: result.allowEmpty,
    ignore: result.ignore,
  };
  if (result.error) body.error = result.error;
  body.keys = result.keys;
  body.counts = result.counts;
  body.issues = result.issues;
  return `${JSON.stringify(body, null, 2)}\n`;
}

function formatIssue(issue: Issue, paint: Palette): string {
  const mark = issue.severity === "error" ? "✗" : "!";
  const coloredMark = issue.severity === "error" ? paint.red(mark) : paint.yellow(mark);
  const coloredCode = issue.severity === "error" ? paint.red(issue.code) : paint.yellow(issue.code);
  const gap = " ".repeat(CODE_WIDTH - issue.code.length);
  const title = issue.key ?? `${issue.file ?? "file"}:${issue.line ?? 0}`;
  const detail = paint.dim(`${" ".repeat(INDENT)}${issue.message}`);
  return `${coloredMark} ${coloredCode}${gap} ${title}\n${detail}`;
}

function paintSummary(result: CheckResult, paint: Palette): string {
  const text = summary(result);
  if (result.counts.error > 0) return paint.red(text);
  if (result.counts.warning > 0) return paint.yellow(text);
  return text;
}

function summary(result: CheckResult): string {
  const parts: string[] = [];
  if (result.counts.error > 0) {
    parts.push(`${result.counts.error} ${result.counts.error === 1 ? "error" : "errors"}`);
  }
  if (result.counts.warning > 0) {
    parts.push(`${result.counts.warning} ${result.counts.warning === 1 ? "warning" : "warnings"}`);
  }
  const line = parts.join(", ");
  if (!result.strict && result.counts.error === 0 && result.counts.extra > 0) {
    return `${line} (pass --strict to fail on extras)`;
  }
  return line;
}

interface Palette {
  bold: (text: string) => string;
  dim: (text: string) => string;
  red: (text: string) => string;
  green: (text: string) => string;
  yellow: (text: string) => string;
}

function palette(enabled: boolean): Palette {
  const wrap = (open: string) => (text: string) =>
    enabled ? `\u001b[${open}m${text}\u001b[0m` : text;
  return {
    bold: wrap("1"),
    dim: wrap("2"),
    red: wrap("31"),
    green: wrap("32"),
    yellow: wrap("33"),
  };
}
