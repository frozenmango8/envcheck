import type { DuplicateKey, EnvBinding, ParseIssue, ParseResult } from "./types.js";

/**
 * Parse a dotenv-style document.
 *
 * Accepted form: optional `export`, a key matching `[A-Za-z_][A-Za-z0-9_]*`,
 * `=`, then a value. `#` comments and blank lines are ignored. Double quotes
 * expand `\\`, `\"`, `\n`, and `\r` and may span lines. Single quotes are
 * literal and may span lines. An unquoted `#` starts a comment only when
 * whitespace precedes it, so `COLOR=#fff` keeps the hash. `# optional` on the
 * preceding non-comment line, or at the end of the assignment, marks the key
 * optional.
 * The last assignment of a duplicate key wins.
 */
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const OPTIONAL_PATTERN = /^@?optional\b/i;
const ASSIGNMENT_PATTERN = /^(?:export\s+)?([^=\s]+)\s*=(.*)$/;

interface ReadState {
  bindings: EnvBinding[];
  issues: ParseIssue[];
  pendingOptional: boolean;
}

export function parseEnv(content: string): ParseResult {
  let text = content;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const lines = text.split(/\r\n|\n|\r/);
  const state: ReadState = { bindings: [], issues: [], pendingOptional: false };

  let index = 0;
  while (index < lines.length) {
    const raw = lines[index] ?? "";
    const trimmed = raw.trim();

    if (trimmed === "") {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("#")) {
      state.pendingOptional = isOptionalComment(trimmed.slice(1));
      index += 1;
      continue;
    }

    index = readAssignment(lines, index, trimmed, state);
  }

  return finish(state.bindings, state.issues);
}

function isOptionalComment(body: string): boolean {
  return OPTIONAL_PATTERN.test(body.trim());
}

function readAssignment(
  lines: readonly string[],
  index: number,
  trimmed: string,
  state: ReadState,
): number {
  const optional = state.pendingOptional;
  state.pendingOptional = false;

  const match = ASSIGNMENT_PATTERN.exec(trimmed);
  if (!match) {
    state.issues.push({
      code: "invalid_line",
      line: index + 1,
      message: "invalid line (expected KEY=VALUE)",
    });
    return index + 1;
  }

  const name = match[1] ?? "";
  const rest = match[2] ?? "";
  if (!KEY_PATTERN.test(name)) {
    state.issues.push({
      code: "invalid_key",
      line: index + 1,
      message: `invalid variable name "${name}"`,
    });
    return index + 1;
  }

  const quoted = rest.trimStart();
  if (quoted.startsWith('"') || quoted.startsWith("'")) {
    return readQuotedAssignment(lines, index, name, quoted, optional, state);
  }

  const commentAt = findUnquotedComment(rest);
  const rawValue = commentAt === -1 ? rest : rest.slice(0, commentAt);
  const inline = commentAt === -1 ? undefined : rest.slice(commentAt + 1);
  state.bindings.push({
    key: name,
    value: rawValue.trim(),
    line: index + 1,
    endLine: index + 1,
    optional: optional || (inline !== undefined && isOptionalComment(inline)),
  });
  return index + 1;
}

function readQuotedAssignment(
  lines: readonly string[],
  index: number,
  name: string,
  rest: string,
  optional: boolean,
  state: ReadState,
): number {
  const quote = rest[0] === "'" ? "'" : '"';
  const quoted = readQuoted(lines, index, rest.slice(1), quote);
  const line = index + 1;

  if (!quoted.closed) {
    state.issues.push({
      code: "unterminated_quote",
      line,
      key: name,
      message: `unterminated ${quote === '"' ? "double" : "single"} quote`,
    });
    return quoted.endIndex + 1;
  }

  const trailing = quoted.after.trim();
  if (trailing !== "" && !trailing.startsWith("#")) {
    state.issues.push({
      code: "invalid_line",
      line,
      key: name,
      message: "unexpected trailing content",
    });
    return quoted.endIndex + 1;
  }

  const inline = trailing.startsWith("#") ? trailing.slice(1) : undefined;
  state.bindings.push({
    key: name,
    value: quoted.value,
    line,
    endLine: quoted.endIndex + 1,
    optional: optional || (inline !== undefined && isOptionalComment(inline)),
  });
  return quoted.endIndex + 1;
}

function readQuoted(
  lines: readonly string[],
  index: number,
  firstInner: string,
  quote: '"' | "'",
): { value: string; endIndex: number; closed: boolean; after: string } {
  let value = "";
  let cursor = index;
  let chunk = firstInner;

  while (true) {
    const end = quote === '"' ? findDoubleQuoteEnd(chunk) : chunk.indexOf("'");
    if (end !== -1) {
      const inner = chunk.slice(0, end);
      value += quote === '"' ? unescapeDouble(inner) : inner;
      return { value, endIndex: cursor, closed: true, after: chunk.slice(end + 1) };
    }

    value += quote === '"' ? unescapeDouble(chunk) : chunk;
    if (cursor + 1 >= lines.length) {
      return { value, endIndex: cursor, closed: false, after: "" };
    }
    value += "\n";
    cursor += 1;
    chunk = lines[cursor] ?? "";
  }
}

/** Index of an unescaped closing double quote, or -1. */
function findDoubleQuoteEnd(value: string): number {
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === "\\") {
      i += 1;
      continue;
    }
    if (value[i] === '"') return i;
  }
  return -1;
}

function unescapeDouble(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char !== "\\") {
      out += char ?? "";
      continue;
    }
    const next = value[i + 1];
    if (next === undefined) {
      out += "\\";
      break;
    }
    i += 1;
    if (next === "n") out += "\n";
    else if (next === "r") out += "\r";
    else if (next === "\\") out += "\\";
    else if (next === '"') out += '"';
    else out += `\\${next}`;
  }
  return out;
}

/** Index of a `#` that starts an unquoted comment, or -1. A leading `#` is data. */
function findUnquotedComment(value: string): number {
  for (let i = 1; i < value.length; i += 1) {
    if (value[i] !== "#") continue;
    const previous = value[i - 1];
    if (previous !== undefined && /\s/.test(previous)) return i;
  }
  return -1;
}

function finish(bindings: readonly EnvBinding[], issues: readonly ParseIssue[]): ParseResult {
  const values = new Map<string, EnvBinding>();
  const linesByKey = new Map<string, number[]>();

  for (const binding of bindings) {
    const lines = linesByKey.get(binding.key);
    if (lines) lines.push(binding.line);
    else linesByKey.set(binding.key, [binding.line]);
    values.set(binding.key, binding);
  }

  const duplicates: DuplicateKey[] = [];
  for (const [key, lines] of linesByKey) {
    if (lines.length > 1) duplicates.push({ key, lines: [...lines] });
  }

  return {
    bindings: [...bindings],
    values,
    duplicates,
    issues: [...issues],
  };
}
