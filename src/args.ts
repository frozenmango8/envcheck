import { parseArgs } from "node:util";

export interface CliFlags {
  envPath: string;
  examplePath: string;
  strict: boolean;
  allowEmpty: boolean;
  ignore: string[];
  json: boolean;
  quiet: boolean;
  noColor: boolean;
  help: boolean;
  version: boolean;
}

export type ArgResult =
  | { ok: true; flags: CliFlags }
  | { ok: false; message: string; json: boolean };

const VALUE_FLAGS = new Set(["--env", "-e", "--example", "-x", "--ignore", "-i"]);

export const HELP = `envcheck — validate .env against .env.example

Usage:
  envcheck [options]

Options:
  -e, --env <path>       File to validate (default: .env)
  -x, --example <path>   Contract file (default: .env.example)
  -s, --strict           Fail when .env has keys the example does not
      --allow-empty      Allow empty values that the example fills in
  -i, --ignore <keys>    Skip keys; repeat the flag or separate with commas
  -j, --json             Print the report as JSON
  -q, --quiet            Print nothing when the check passes
      --no-color         Disable color
  -h, --help             Show this help
  -v, --version          Show the version

Exit codes:
  0  The env file satisfies the example. Extras are warnings unless --strict.
  1  A required key is missing, empty, or duplicated, or --strict found extras.
  2  A file, parse, or usage error.

A key in the example may be optional: put "# optional" on the line above it,
or at the end of its line. Values are never printed.

Examples:
  envcheck
  envcheck --strict
  envcheck --env .env.local --example .env.example
  envcheck --json
`;

export function parseArgv(argv: readonly string[]): ArgResult {
  try {
    const { values } = parseArgs({
      args: [...argv],
      strict: true,
      allowPositionals: false,
      options: {
        env: { type: "string", short: "e", default: ".env" },
        example: { type: "string", short: "x", default: ".env.example" },
        strict: { type: "boolean", short: "s", default: false },
        "allow-empty": { type: "boolean", default: false },
        ignore: { type: "string", short: "i", multiple: true },
        json: { type: "boolean", short: "j", default: false },
        quiet: { type: "boolean", short: "q", default: false },
        "no-color": { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
    });

    const envPath = values.env ?? ".env";
    const examplePath = values.example ?? ".env.example";
    if (envPath.trim() === "") {
      return { ok: false, message: "--env requires a path", json: values.json ?? false };
    }
    if (examplePath.trim() === "") {
      return { ok: false, message: "--example requires a path", json: values.json ?? false };
    }
    for (const entry of values.ignore ?? []) {
      if (entry.trim() === "") {
        return { ok: false, message: "--ignore requires a key", json: values.json ?? false };
      }
    }

    return {
      ok: true,
      flags: {
        envPath,
        examplePath,
        strict: values.strict ?? false,
        allowEmpty: values["allow-empty"] ?? false,
        ignore: values.ignore ?? [],
        json: values.json ?? false,
        quiet: values.quiet ?? false,
        noColor: values["no-color"] ?? false,
        help: values.help ?? false,
        version: values.version ?? false,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not parse arguments";
    return { ok: false, message, json: argvWantsJson(argv) };
  }
}

function argvWantsJson(argv: readonly string[]): boolean {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--json" || arg === "-j") return true;
    if (VALUE_FLAGS.has(arg)) i += 1;
  }
  return false;
}
