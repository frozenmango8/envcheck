import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkSources } from "../src/check.js";
import type { CheckOptions } from "../src/types.js";

const SECRET = "super-secret-value";

function check(env: string, example: string, options?: CheckOptions) {
  return checkSources(
    {
      env: { path: ".env", content: env },
      example: { path: ".env.example", content: example },
    },
    options,
  );
}

describe("checkSources", () => {
  it("passes when every example key is set", () => {
    const result = check("PORT=3000\nNODE_ENV=test\n", "PORT=3000\nNODE_ENV=development\n");
    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    assert.equal(result.issues.length, 0);
    assert.deepEqual(result.keys, { env: 2, example: 2 });
  });

  it("reports a missing key and does not include values", () => {
    const result = check(`PRESENT=1\n`, `PRESENT=1\nDATABASE_URL=${SECRET}\n`);
    assert.equal(result.exitCode, 1);
    assert.equal(result.counts.missing, 1);
    assert.equal(result.issues[0]?.key, "DATABASE_URL");
    assert.equal(result.issues[0]?.line, 2);
    assert.equal(result.issues[0]?.message, "required in .env.example:2, missing from .env");
    assert.equal(JSON.stringify(result).includes(SECRET), false);
  });

  it("reports an empty value only when the example shows a value", () => {
    const emptyRequired = check("API_KEY=\n", "API_KEY=replace-me\n");
    assert.equal(emptyRequired.counts.empty, 1);
    assert.equal(emptyRequired.exitCode, 1);
    assert.equal(
      emptyRequired.issues[0]?.message,
      "empty in .env:1; .env.example:1 expects a value",
    );

    const placeholder = check("LOG_LEVEL=\n", "LOG_LEVEL=\n");
    assert.equal(placeholder.ok, true);

    const quotedBlank = check('TOKEN="   "\n', "TOKEN=real\n");
    assert.equal(quotedBlank.counts.empty, 1);

    const zero = check("PORT=0\nFEATURE=false\n", "PORT=3000\nFEATURE=true\n");
    assert.equal(zero.ok, true);
  });

  it("allows a missing or empty key marked optional", () => {
    const example = "# optional\nSENTRY_DSN=https://example\nREQUIRED=1\n";
    const missing = check("REQUIRED=1\n", example);
    assert.equal(missing.ok, true);

    const empty = check("SENTRY_DSN=\nREQUIRED=1\n", example);
    assert.equal(empty.ok, true);

    const absentRequired = check("SENTRY_DSN=1\n", example);
    assert.equal(absentRequired.counts.missing, 1);
    assert.equal(absentRequired.issues[0]?.key, "REQUIRED");
  });

  it("warns on extras unless strict", () => {
    const result = check("A=1\nDEBUG=1\n", "A=1\n");
    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    assert.equal(result.issues[0]?.severity, "warning");
    assert.equal(result.issues[0]?.code, "extra");
    assert.equal(result.counts.warning, 1);

    const strict = check("A=1\nDEBUG=1\n", "A=1\n", { strict: true });
    assert.equal(strict.ok, false);
    assert.equal(strict.exitCode, 1);
    assert.equal(strict.issues[0]?.severity, "error");
  });

  it("reports duplicates in either file and compares the last value", () => {
    const envDup = check("PORT=1\nPORT=\n", "PORT=3000\n");
    assert.equal(envDup.counts.duplicate, 1);
    assert.equal(envDup.counts.empty, 1);
    assert.equal(envDup.issues[0]?.code, "duplicate");
    assert.deepEqual(envDup.issues[0]?.lines, [1, 2]);
    assert.equal(
      envDup.issues[0]?.message,
      "defined twice in .env (lines 1 and 2); last value wins",
    );
    assert.equal(envDup.exitCode, 1);

    const filled = check("PORT=\nPORT=3000\n", "PORT=1\n");
    assert.equal(filled.counts.duplicate, 1);
    assert.equal(filled.counts.empty, 0);

    const exampleDup = check("A=1\n", "A=1\nA=2\nA=3\n");
    assert.equal(exampleDup.counts.duplicate, 1);
    assert.equal(
      exampleDup.issues[0]?.message,
      "defined 3 times in .env.example (lines 1, 2, and 3); last value wins",
    );
  });

  it("skips ignored keys for missing, empty, extra, and duplicate", () => {
    const result = check("EXTRA=1\nKEEP=\nKEEP=1\n", "MISSING=1\nKEEP=value\n", {
      ignore: ["MISSING, EXTRA", "KEEP"],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.ignore, ["MISSING", "EXTRA", "KEEP"]);
    assert.equal(result.issues.length, 0);
  });

  it("allowEmpty suppresses empty values and still reports missing keys", () => {
    const result = check("API_KEY=\n", "API_KEY=x\nOTHER=y\n", { allowEmpty: true });
    assert.equal(result.counts.empty, 0);
    assert.equal(result.counts.missing, 1);
    assert.equal(result.exitCode, 1);
    assert.equal(result.allowEmpty, true);
  });

  it("exits 2 on a parse error and skips a broken key instead of calling it missing", () => {
    const result = check('API_KEY="unterminated\n', "API_KEY=present\nOTHER=1\n");
    assert.equal(result.exitCode, 2);
    assert.equal(result.counts.parse, 1);
    assert.equal(result.counts.missing, 1);
    assert.equal(result.issues[0]?.code, "parse");
    assert.equal(result.issues[0]?.key, "API_KEY");
    assert.equal(result.issues[1]?.key, "OTHER");
  });

  it("orders parse, duplicate, missing, empty, then extra", () => {
    const env = ["PORT=1", "PORT=2", "EMPTY=", "EXTRA=1", "BAD LINE"].join("\n");
    const example = ["PORT=1", "EMPTY=needed", "GONE=1"].join("\n");
    const result = check(env, example);
    assert.deepEqual(
      result.issues.map((issue) => issue.code),
      ["parse", "duplicate", "missing", "empty", "extra"],
    );
  });

  it("sorts example parse issues before env parse issues", () => {
    const result = check("NOPE\n", "ALSO NOPE\n");
    assert.equal(result.issues[0]?.file, ".env.example");
    assert.equal(result.issues[1]?.file, ".env");
    assert.equal(result.exitCode, 2);
  });

  it("does not treat a key broken in the example as an extra", () => {
    const result = check("TOKEN=1\n", 'TOKEN="unterminated\n');
    assert.equal(result.counts.extra, 0);
    assert.equal(result.counts.parse, 1);
    assert.equal(result.exitCode, 2);
  });

  it("matches two empty files", () => {
    const result = check("", "");
    assert.equal(result.ok, true);
    assert.deepEqual(result.keys, { env: 0, example: 0 });
  });
});
