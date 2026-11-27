/** A variable assignment successfully read from one file. */
export interface EnvBinding {
  key: string;
  /** Decoded value. Callers must not print this. */
  value: string;
  /** 1-based line where the assignment starts. */
  line: number;
  /** 1-based line where the assignment ends. Equals `line` for single-line values. */
  endLine: number;
  /** True when the example marks this key with `# optional`. */
  optional: boolean;
}

export type ParseIssueCode = "invalid_line" | "invalid_key" | "unterminated_quote";

export interface ParseIssue {
  code: ParseIssueCode;
  /** 1-based line of the assignment that failed. */
  line: number;
  message: string;
  /** Set when the key was recognized but the value could not be read. */
  key?: string;
}

export interface DuplicateKey {
  key: string;
  /** 1-based start lines, in file order. */
  lines: number[];
}

export interface ParseResult {
  /** Every successful assignment, including earlier duplicates. */
  bindings: EnvBinding[];
  /** Last assignment wins. Insertion order is first-seen order. */
  values: Map<string, EnvBinding>;
  duplicates: DuplicateKey[];
  issues: ParseIssue[];
}

export type IssueCode = "missing" | "empty" | "extra" | "duplicate" | "parse";

export type Severity = "error" | "warning";

export interface Issue {
  code: IssueCode;
  severity: Severity;
  /** Detail line. Never includes the variable's value. */
  message: string;
  key?: string;
  /** Display path of the file the issue is anchored to. */
  file?: string;
  /** 1-based primary line. */
  line?: number;
  /** Every defining line. Present for duplicates. */
  lines?: number[];
}

export type FileErrorCode = "not_found" | "unreadable" | "usage";

export interface FileError {
  code: FileErrorCode;
  message: string;
  path?: string;
}

export interface Counts {
  error: number;
  warning: number;
  missing: number;
  empty: number;
  extra: number;
  duplicate: number;
  parse: number;
}

export interface CheckOptions {
  /** Report extras as errors. Default: extras are warnings and exit 0. */
  strict?: boolean;
  /** Do not fail when a required value is empty. Missing keys still fail. */
  allowEmpty?: boolean;
  /** Keys to leave out of the comparison. Comma-separated entries are split. */
  ignore?: readonly string[];
}

export interface CheckResult {
  /** True when the process should exit 0. Warnings (extras without `--strict`) still count as ok. */
  ok: boolean;
  exitCode: 0 | 1 | 2;
  envPath: string;
  examplePath: string;
  strict: boolean;
  allowEmpty: boolean;
  ignore: string[];
  error?: FileError;
  keys: {
    env: number;
    example: number;
  };
  counts: Counts;
  issues: Issue[];
}
