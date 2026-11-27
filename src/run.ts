import { HELP, parseArgv } from "./args.js";
import { checkFiles } from "./files.js";
import { formatHuman, formatJson } from "./format.js";
import { finalize } from "./result.js";
import type { CheckResult } from "./types.js";
import { packageVersion } from "./version.js";

export interface TextWriter {
  write(chunk: string): unknown;
  isTTY?: boolean;
}

export interface Io {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: TextWriter;
  stderr: TextWriter;
}

/** Run the CLI and return the exit code. Writes the report to `io`. */
export function run(argv: readonly string[], io: Io): number {
  const parsed = parseArgv(argv);
  if (!parsed.ok) {
    const result = usageResult(parsed.message);
    writeReport(result, { json: parsed.json, quiet: false, color: false }, io);
    if (!parsed.json) io.stderr.write("Run envcheck --help for usage.\n");
    return result.exitCode;
  }

  const flags = parsed.flags;
  if (flags.help) {
    io.stdout.write(HELP);
    return 0;
  }
  if (flags.version) {
    io.stdout.write(`envcheck ${packageVersion()}\n`);
    return 0;
  }

  const result = checkFiles({
    cwd: io.cwd,
    envPath: flags.envPath,
    examplePath: flags.examplePath,
    strict: flags.strict,
    allowEmpty: flags.allowEmpty,
    ignore: flags.ignore,
  });

  writeReport(
    result,
    { json: flags.json, quiet: flags.quiet, color: wantColor(flags.noColor, io) },
    io,
  );
  return result.exitCode;
}

function writeReport(
  result: CheckResult,
  options: { json: boolean; quiet: boolean; color: boolean },
  io: Io,
): void {
  if (options.json) {
    io.stdout.write(formatJson(result));
    return;
  }

  const quietSuccess = options.quiet && result.exitCode === 0 && result.issues.length === 0;
  if (quietSuccess) return;

  const text = formatHuman(result, { color: options.color });
  if (result.error) io.stderr.write(text);
  else io.stdout.write(text);
}

function wantColor(noColor: boolean, io: Io): boolean {
  if (noColor) return false;
  const disabled = io.env.NO_COLOR;
  if (typeof disabled === "string" && disabled !== "") return false;
  const forced = io.env.FORCE_COLOR;
  if (typeof forced === "string" && forced !== "" && forced !== "0") return true;
  return Boolean(io.stdout.isTTY);
}

function usageResult(message: string): CheckResult {
  return finalize({
    envPath: ".env",
    examplePath: ".env.example",
    strict: false,
    allowEmpty: false,
    ignore: [],
    issues: [],
    keys: { env: 0, example: 0 },
    error: { code: "usage", message },
  });
}
