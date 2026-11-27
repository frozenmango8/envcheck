# Contributing

Thanks for looking at envcheck. The useful change is usually a parser edge case, a clearer report, or a test that locks behavior someone hit in a real `.env` file.

## Setup

You need Node.js 20 or newer.

```bash
git clone https://github.com/frozenmango8/envcheck.git
cd envcheck
npm install
```

## Checks

```bash
npm test          # node:test, through tsx
npm run lint      # biome and tsc --noEmit
npm run format    # biome write
npm run build     # tsc to dist/
node dist/cli.js --help
```

Run one file:

```bash
node --import tsx --test test/parse.test.ts
```

`npm test` does not require a build. CI builds `dist/` and runs `dist/cli.js --help` and `--version` after the tests.

## Layout

```text
src/cli.ts       process entry, shebang
src/run.ts       argv to exit code, no process.exit
src/args.ts      node:util parseArgs and help text
src/parse.ts     dotenv-style parser
src/check.ts     missing, empty, extra, duplicate
src/files.ts     read files and map OS errors
src/format.ts    human and JSON reports
src/index.ts     public API
test/            node:test suites
```

Library code stays free of `console` and of `process.exit`, so tests can call `run()` and `checkSources()` directly. There are no runtime dependencies. Please keep it that way unless a dependency replaces something we would otherwise get wrong.

## Behavior worth preserving

- Reports name keys and whether a value is empty. They never include the value. Tests use the sentinel `super-secret-value` and assert it does not appear in any output.
- Exit 0 means the example is satisfied. Extras are warnings unless `--strict`.
- Exit 1 means missing, empty, duplicate, or a strict extra.
- Exit 2 means a file, parse, or usage problem, even if other issues were also found.
- The last duplicate wins, and the duplicate is still an error.
- `# optional` / `# @optional` on the previous comment, or inline, marks a key optional. The marker applies to the next assignment. A blank line in between is fine. Another comment replaces it.
- Double quotes expand only `\\`, `\"`, `\n`, and `\r`.
- JSON is a stable, pretty-printed document on stdout. Do not add fields casually. If you do, update the README schema and a test.

## Pull requests

- Add or adjust a unit test for parser, checker, or CLI changes. A failing case from a real file is the best kind.
- Run `npm test` and `npm run lint` before pushing.
- Keep the diff focused. A new flag needs a help line, a README row, and an exit-code test.
- Commit messages should say what changed and why, in the imperative ("Report whitespace-only values as empty").

## Publishing

The package name is `@frozenmango8/envcheck` and the binary is `envcheck`. `npm publish` runs lint, tests, and the build through `prepublishOnly`. Do not publish from a dirty tree.
