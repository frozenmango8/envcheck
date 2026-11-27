# envcheck

[![CI](https://github.com/frozenmango8/envcheck/actions/workflows/ci.yml/badge.svg)](https://github.com/frozenmango8/envcheck/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@frozenmango8/envcheck.svg)](https://www.npmjs.com/package/@frozenmango8/envcheck)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933)](https://nodejs.org)
[![license](https://img.shields.io/github/license/frozenmango8/envcheck)](LICENSE)

Validate a project's `.env` against `.env.example` before a missing or empty variable breaks the app. envcheck is a small Node.js CLI with no runtime dependencies, a non-zero exit code for CI, and output that never prints secret values.

`.env.example` is the contract: every key a developer or a pipeline is expected to set. `.env` is the file you actually have. They drift when someone adds `STRIPE_WEBHOOK_SECRET` to the example, leaves `API_KEY=` blank, or keeps a leftover variable that production will never have. envcheck reads both files and reports the difference.

```text
envcheck: .env vs .env.example

✗ missing   DATABASE_URL
            required in .env.example:1, missing from .env

✗ empty     API_KEY
            empty in .env:1; .env.example:2 expects a value

! extra     DEBUG
            in .env:2, not in .env.example

2 errors, 1 warning
```

## Install

The command is `envcheck`. The npm package is [`@frozenmango8/envcheck`](https://www.npmjs.com/package/@frozenmango8/envcheck). The unscoped name `envcheck` already belongs to an unrelated Yeoman package, so a one-off `npx envcheck` without a local install would run that other tool.

Add it to the project, then run the local binary:

```bash
npm install --save-dev @frozenmango8/envcheck
npx envcheck
```

Or run it once without adding the dependency:

```bash
npx @frozenmango8/envcheck
```

Node.js 20 or newer is required. The programmatic API is ESM-only.

## Usage

Check the default files, `.env` and `.env.example`, from the current directory:

```bash
npx envcheck
```

Fail the process when `.env` contains keys that the example does not:

```bash
npx envcheck --strict
```

Use other filenames:

```bash
npx envcheck --env .env.local --example .env.example
npx envcheck -e .env.production -x .env.production.example --strict
```

Machine-readable output, for a wrapper or a CI annotation:

```bash
npx envcheck --json
```

Skip keys that are injected by the platform, and allow blank values when the example only exists to show the name:

```bash
npx envcheck --ignore VERCEL_ENV,VERCEL_URL --allow-empty
```

`--quiet` prints nothing when the check passes. Failures are still printed. `--json` always prints the report.

### Options

| Flag                   | Description                                                     |
| ---------------------- | --------------------------------------------------------------- |
| `-e, --env <path>`     | File to validate. Default: `.env`.                              |
| `-x, --example <path>` | Contract file. Default: `.env.example`.                         |
| `-s, --strict`         | Exit 1 when `.env` has keys that are not in the example.        |
| `--allow-empty`        | Do not fail when a value is empty. Missing keys still fail.     |
| `-i, --ignore <keys>`  | Skip these keys. Repeat the flag or separate names with commas. |
| `-j, --json`           | Print a JSON report on stdout.                                  |
| `-q, --quiet`          | Print nothing when the check passes.                            |
| `--no-color`           | Disable color. `NO_COLOR` is also honored.                      |
| `-h, --help`           | Show help.                                                      |
| `-v, --version`        | Show the version.                                               |

Color is on when stdout is a TTY, or when `FORCE_COLOR` is set to anything other than `0`. `--no-color` and a non-empty `NO_COLOR` turn it off.

## Rules

envcheck compares **names and emptiness**. It does not compare values. A placeholder in `.env.example` and a real secret in `.env` are supposed to differ.

A value is empty when it is empty or only whitespace, including `""` and `''`. `0` and `false` are values.

| `.env.example`                   | `.env`          | Result                                                            |
| -------------------------------- | --------------- | ----------------------------------------------------------------- |
| `KEY=some-value`                 | `KEY=real`      | Ok                                                                |
| `KEY=some-value`                 | `KEY=`          | **empty** (error)                                                 |
| `KEY=some-value`                 | key absent      | **missing** (error)                                               |
| `KEY=`                           | `KEY=`          | Ok. The example does not ask for a value.                         |
| `KEY=`                           | key absent      | **missing** (error). The key still has to exist.                  |
| `# optional` then `KEY=...`      | absent or empty | Ok                                                                |
| key absent                       | `KEY=anything`  | **extra** (warning, or an error with `--strict`)                  |
| `KEY` assigned twice in one file |                 | **duplicate** (error). The last value is the one that is checked. |

Ignored keys are left out of every check, including duplicates.

### Optional keys

Put a comment whose text starts with `optional` or `@optional` on the line above the key, or at the end of the assignment. A blank line between the comment and the key is fine. A later comment replaces the marker.

```bash
# Required. An empty .env value fails because a value is shown here.
DATABASE_URL=postgres://localhost:5432/app

# Presence is enough. An empty .env value is ok.
LOG_LEVEL=

# optional
SENTRY_DSN=

# @optional — local overrides only
DEBUG=true

FEATURE_FLAG=off # optional
```

## File format

The parser covers the `.env` files people actually commit:

- Blank lines and `#` comments are ignored.
- `export KEY=value` is accepted, and spaces around `=` are allowed.
- An unquoted `#` starts a comment when it begins the value or follows whitespace. `COLOR=#fff` keeps the hash.
- Double quotes may span lines. Inside them, `\\`, `\"`, `\n`, and `\r` are escapes. Any other `\x` is kept, so `C:\temp` is safe. Use single quotes when you want every character literal.
- Single quotes may span lines and are literal. The first `'` ends the value.
- Keys must match `[A-Za-z_][A-Za-z0-9_]*`.
- A line that is not an assignment is a parse error. Fix it before trusting the rest of the report.
- Values are not expanded. `${OTHER}` is literal text, not a lookup.
- The same key may appear twice. That is reported, and the last assignment wins.

```bash
# comment
export DATABASE_URL=postgres://localhost/app
WELCOME="hello
world"
COLOR=#fff # not a comment
```

## Exit codes

| Code | Meaning                                                                                |
| ---- | -------------------------------------------------------------------------------------- |
| 0    | The file satisfies the example. Extras are warnings unless `--strict`.                 |
| 1    | A key is missing, empty, or duplicated, or `--strict` found an extra.                  |
| 2    | The file is missing or unreadable, a line failed to parse, or the arguments are wrong. |

A parse error is exit 2 even when other issues are present. The report still lists those issues, with parse errors first. `ok` in the JSON is true only for exit 0, so a run that only has extra-key warnings is `ok`.

## JSON

`--json` writes a single JSON document to stdout and does not color it. File, parse, and usage failures stay on stdout so `envcheck --json | jq .` works. The human report writes file and usage errors to stderr instead.

```json
{
  "ok": false,
  "exitCode": 1,
  "env": ".env",
  "example": ".env.example",
  "strict": false,
  "allowEmpty": false,
  "ignore": [],
  "keys": { "env": 1, "example": 2 },
  "counts": {
    "error": 1,
    "warning": 0,
    "missing": 1,
    "empty": 0,
    "extra": 0,
    "duplicate": 0,
    "parse": 0
  },
  "issues": [
    {
      "code": "missing",
      "severity": "error",
      "key": "DATABASE_URL",
      "file": ".env.example",
      "line": 2,
      "message": "required in .env.example:2, missing from .env"
    }
  ]
}
```

When the files cannot be read, or the arguments are invalid, `issues` is empty and `error` is set:

```json
{
  "error": {
    "code": "not_found",
    "path": ".env",
    "message": "no such file: .env. Create it, or pass --env <path>."
  }
}
```

`error.code` is `not_found`, `unreadable`, or `usage`. Issue `code` is `missing`, `empty`, `extra`, `duplicate`, or `parse`. Duplicates also include `lines`.

Values are omitted on purpose. A CI log should be safe to scroll.

## CI

Once `@frozenmango8/envcheck` is installed, `npx envcheck` runs this package. On a machine with no local install, the unscoped name belongs to a different tool, so call the scoped package directly: `npx @frozenmango8/envcheck --strict`.

```yaml
- name: Install
  run: npm ci
- name: Check environment contract
  run: npx envcheck --strict
```

A pipeline that builds `.env` from secrets before the check:

```yaml
- name: Materialize .env
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
    API_KEY: ${{ secrets.API_KEY }}
  run: |
    umask 077
    cat > .env << EOF
    DATABASE_URL=${DATABASE_URL}
    API_KEY=${API_KEY}
    EOF
- name: Check environment contract
  run: npx @frozenmango8/envcheck --strict
```

Values that contain newlines or shell metacharacters need to be written with care. The heredoc above does not quote them. The scoped `npx` call does not depend on a local install.

In a package script:

```json
{
  "scripts": {
    "env:check": "envcheck --strict"
  }
}
```

This repository's own workflow runs lint, tests, and a build on Node 20, 22, and 24 for every push to `main` and every pull request.

## Programmatic API

```ts
import { checkFiles } from "@frozenmango8/envcheck";

const result = checkFiles({
  envPath: ".env",
  examplePath: ".env.example",
  strict: true,
});

if (result.exitCode !== 0) {
  console.error(result.issues.map((issue) => issue.message).join("\n"));
  process.exit(result.exitCode);
}
```

`checkSources` compares strings without touching the disk. `parseEnv` returns the bindings, which include values — do not log that object. `formatHuman` and `formatJson` produce the same reports as the CLI.

```ts
import { checkSources, formatJson } from "@frozenmango8/envcheck";

const result = checkSources(
  {
    env: { path: ".env", content: envText },
    example: { path: ".env.example", content: exampleText },
  },
  { ignore: ["CI"] },
);

process.stdout.write(formatJson(result));
```

## Development

Contributing, layout, and how to run the tests are in [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
npm install
npm test
npm run lint
npm run build
```

## License

[MIT](LICENSE) © frozenmango8
