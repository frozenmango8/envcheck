import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { type Io, run } from "../src/run.js";

const SECRET = "super-secret-value";
const root = fileURLToPath(new URL("..", import.meta.url));
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "envcheck-"));
}

function write(dir: string, name: string, content: string): void {
  writeFileSync(join(dir, name), content);
}

function capture(
  cwd: string,
  options?: { tty?: boolean; env?: NodeJS.ProcessEnv },
): Io & {
  stdoutText: () => string;
  stderrText: () => string;
} {
  let stdoutText = "";
  let stderrText = "";
  const tty = options?.tty ?? false;
  return {
    cwd,
    env: options?.env ?? {},
    stdout: {
      isTTY: tty,
      write(chunk: string) {
        stdoutText += chunk;
        return true;
      },
    },
    stderr: {
      isTTY: tty,
      write(chunk: string) {
        stderrText += chunk;
        return true;
      },
    },
    stdoutText: () => stdoutText,
    stderrText: () => stderrText,
  };
}

describe("cli", () => {
  it("prints a one-line success report and exits 0", () => {
    const dir = tempDir();
    write(dir, ".env", "A=1\nB=2\n");
    write(dir, ".env.example", "A=1\nB=two\n");
    const io = capture(dir);
    const code = run([], io);
    assert.equal(code, 0);
    assert.equal(io.stdoutText(), "✓ .env matches .env.example (2 keys)\n");
    assert.equal(io.stderrText(), "");
  });

  it("mentions strict mode when the check passes", () => {
    const dir = tempDir();
    write(dir, ".env", "A=1\n");
    write(dir, ".env.example", "A=x\n");
    const io = capture(dir);
    assert.equal(run(["--strict"], io), 0);
    assert.equal(io.stdoutText(), "✓ .env matches .env.example (1 key, strict)\n");
  });

  it("reports missing keys with exit code 1", () => {
    const dir = tempDir();
    write(dir, ".env", "");
    write(dir, ".env.example", "DATABASE_URL=postgres://localhost/app\n");
    const io = capture(dir);
    assert.equal(run([], io), 1);
    assert.equal(
      io.stdoutText(),
      [
        "envcheck: .env vs .env.example",
        "",
        "✗ missing   DATABASE_URL",
        "            required in .env.example:1, missing from .env",
        "",
        "1 error",
        "",
      ].join("\n"),
    );
  });

  it("warns on extras and stays at exit 0 until --strict", () => {
    const dir = tempDir();
    write(dir, ".env", "A=1\nDEBUG=1\n");
    write(dir, ".env.example", "A=1\n");
    const io = capture(dir);
    assert.equal(run([], io), 0);
    assert.equal(
      io.stdoutText(),
      [
        "envcheck: .env vs .env.example",
        "",
        "! extra     DEBUG",
        "            in .env:2, not in .env.example",
        "",
        "1 warning (pass --strict to fail on extras)",
        "",
      ].join("\n"),
    );

    const strict = capture(dir);
    assert.equal(run(["--strict"], strict), 1);
    assert.match(strict.stdoutText(), /✗ extra\s+DEBUG/);
    assert.match(strict.stdoutText(), /1 error/);
  });

  it("exits 2 when a file is missing, a directory, or unreadable", () => {
    const dir = tempDir();
    write(dir, ".env.example", "A=1\n");
    const missing = capture(dir);
    assert.equal(run([], missing), 2);
    assert.equal(missing.stdoutText(), "");
    assert.match(missing.stderrText(), /no such file: \.env/);
    assert.match(missing.stderrText(), /--env/);

    write(dir, ".env", "A=1\n");
    const missingExample = capture(dir);
    assert.equal(run(["--example", "missing.example"], missingExample), 2);
    assert.match(missingExample.stderrText(), /no such file: missing\.example/);
    assert.match(missingExample.stderrText(), /--example/);

    const directory = capture(dir);
    assert.equal(run(["--env", dir], directory), 2);
    assert.match(directory.stderrText(), /is a directory/);

    const locked = join(dir, "locked.env");
    writeFileSync(locked, "A=1\n");
    chmodSync(locked, 0o000);
    try {
      const denied = capture(dir);
      assert.equal(run(["--env", locked], denied), 2);
      assert.match(denied.stderrText(), /permission denied/);
    } finally {
      chmodSync(locked, 0o600);
    }
  });

  it("reads custom paths, ignore lists, and --allow-empty", () => {
    const dir = tempDir();
    write(dir, ".env.production", "API_KEY=\nEXTRA=1\n");
    write(dir, "contract.env", "API_KEY=needed\nSKIP=1\n");
    const io = capture(dir);
    const code = run(
      ["-e", ".env.production", "-x", "contract.env", "--allow-empty", "--ignore", "EXTRA,SKIP"],
      io,
    );
    assert.equal(code, 0);
    assert.match(io.stdoutText(), /\.env\.production matches contract\.env/);
  });

  it("prints JSON without values, including on failure", () => {
    const dir = tempDir();
    write(dir, ".env", "A=\n");
    write(dir, ".env.example", `A=${SECRET}\nB=1\n`);
    const io = capture(dir, { tty: true });
    assert.equal(run(["--json", "--strict"], io), 1);
    const parsed = JSON.parse(io.stdoutText()) as {
      ok: boolean;
      exitCode: number;
      strict: boolean;
      counts: { missing: number; empty: number };
      issues: Array<{ key?: string; code: string }>;
    };
    assert.equal(parsed.ok, false);
    assert.equal(parsed.exitCode, 1);
    assert.equal(parsed.strict, true);
    assert.equal(parsed.counts.empty, 1);
    assert.equal(parsed.counts.missing, 1);
    assert.deepEqual(
      parsed.issues.map((issue) => issue.key),
      ["B", "A"],
    );
    assert.equal(io.stdoutText().includes(SECRET), false);
    assert.equal(io.stdoutText().includes("\u001b["), false);
    assert.equal(io.stderrText(), "");
  });

  it("uses the full JSON envelope for a missing file", () => {
    const dir = tempDir();
    const io = capture(dir);
    assert.equal(run(["--json"], io), 2);
    const parsed = JSON.parse(io.stdoutText()) as {
      ok: boolean;
      exitCode: number;
      error: { code: string; path: string };
      issues: unknown[];
    };
    assert.equal(parsed.ok, false);
    assert.equal(parsed.exitCode, 2);
    assert.equal(parsed.error.code, "not_found");
    assert.equal(parsed.error.path, ".env");
    assert.deepEqual(parsed.issues, []);
  });

  it("stays silent on success when --quiet, and still prints failures", () => {
    const dir = tempDir();
    write(dir, ".env", "A=1\n");
    write(dir, ".env.example", "A=1\n");
    const quiet = capture(dir);
    assert.equal(run(["--quiet"], quiet), 0);
    assert.equal(quiet.stdoutText(), "");

    write(dir, ".env.example", "A=1\nB=2\n");
    const failing = capture(dir);
    assert.equal(run(["-q"], failing), 1);
    assert.match(failing.stdoutText(), /missing\s+B/);

    const json = capture(dir);
    assert.equal(run(["--quiet", "--json"], json), 1);
    assert.equal(JSON.parse(json.stdoutText()).ok, false);
  });

  it("colors a TTY and honors NO_COLOR and --no-color", () => {
    const dir = tempDir();
    write(dir, ".env", "");
    write(dir, ".env.example", "A=1\n");
    const colored = capture(dir, { tty: true });
    run([], colored);
    assert.match(colored.stdoutText(), ansi("\\[31m"));
    const plain = capture(dir);
    run(["--no-color"], plain);
    assert.equal(stripAnsi(colored.stdoutText()), plain.stdoutText());

    const noColor = capture(dir, { tty: true, env: { NO_COLOR: "1" } });
    run([], noColor);
    assert.equal(noColor.stdoutText().includes("\u001b["), false);

    const flagged = capture(dir, { tty: true, env: { FORCE_COLOR: "1" } });
    run(["--no-color"], flagged);
    assert.equal(flagged.stdoutText().includes("\u001b["), false);

    const forced = capture(dir, { env: { FORCE_COLOR: "1" } });
    run([], forced);
    assert.match(forced.stdoutText(), ansi("\\[31m"));
  });

  it("prints help and version", () => {
    const io = capture(tempDir());
    assert.equal(run(["--help"], io), 0);
    assert.match(io.stdoutText(), /--strict/);
    assert.match(io.stdoutText(), /--json/);
    assert.match(io.stdoutText(), /--example/);
    assert.match(io.stdoutText(), /Values are never printed/);

    const version = capture(tempDir());
    assert.equal(run(["-v"], version), 0);
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
    assert.equal(version.stdoutText(), `envcheck ${pkg.version}\n`);
  });

  it("exits 2 on bad usage and can report it as JSON", () => {
    const io = capture(tempDir());
    assert.equal(run(["--unknown"], io), 2);
    assert.match(io.stderrText(), /Unknown option '--unknown'/);
    assert.match(io.stderrText(), /envcheck --help/);

    const json = capture(tempDir());
    assert.equal(run(["--json", "positional"], json), 2);
    const parsed = JSON.parse(json.stdoutText()) as { exitCode: number; error: { code: string } };
    assert.equal(parsed.exitCode, 2);
    assert.equal(parsed.error.code, "usage");
    assert.equal(json.stderrText(), "");
  });

  it("exits 1 from the executable entrypoint", () => {
    const dir = tempDir();
    write(dir, ".env", "A=1\n");
    write(dir, ".env.example", "A=1\nB=2\n");
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        cli,
        "--no-color",
        "--env",
        join(dir, ".env"),
        "--example",
        join(dir, ".env.example"),
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.match(result.stdout, /missing\s+B/);
  });
});

const ESC = String.fromCharCode(0x1b);

function ansi(pattern: string): RegExp {
  return new RegExp(`${ESC}${pattern}`);
}

function stripAnsi(text: string): string {
  return text.replace(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");
}
