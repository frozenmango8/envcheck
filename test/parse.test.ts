import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseEnv } from "../src/parse.js";

function value(content: string, key: string): string | undefined {
  return parseEnv(content).values.get(key)?.value;
}

describe("parseEnv", () => {
  it("reads KEY=VALUE assignments", () => {
    const result = parseEnv("DATABASE_URL=postgres://localhost/app\nPORT=5432\n");
    assert.equal(result.issues.length, 0);
    assert.equal(
      value("DATABASE_URL=postgres://localhost/app\n", "DATABASE_URL"),
      "postgres://localhost/app",
    );
    assert.equal(result.values.get("PORT")?.value, "5432");
    assert.equal(result.values.get("PORT")?.line, 2);
  });

  it("ignores blanks and full-line comments", () => {
    const result = parseEnv("# database\n\nHOST=localhost\n  # trailing note\n");
    assert.deepEqual([...result.values.keys()], ["HOST"]);
    assert.equal(result.values.get("HOST")?.line, 3);
  });

  it("accepts an export prefix and spaces around equals", () => {
    assert.equal(value("export API_KEY = secret", "API_KEY"), "secret");
    assert.equal(value("export   TOKEN=abc", "TOKEN"), "abc");
  });

  it("treats export=value as a key named export", () => {
    assert.equal(value("export=1", "export"), "1");
  });

  it("strips unquoted inline comments and keeps hashes that are part of the value", () => {
    assert.equal(value("COLOR=#fff", "COLOR"), "#fff");
    assert.equal(value("NAME=Ada Lovelace # author", "NAME"), "Ada Lovelace");
    assert.equal(value("EMPTY= # nothing here", "EMPTY"), "");
  });

  it("keeps equals signs and surrounding spaces inside the value", () => {
    assert.equal(
      value("URL=postgres://user:pass@host/db?ssl=true", "URL"),
      "postgres://user:pass@host/db?ssl=true",
    );
    assert.equal(value("NAME=Ada Lovelace", "NAME"), "Ada Lovelace");
  });

  it("decodes double quotes, including escapes, and leaves unknown escapes intact", () => {
    assert.equal(value('MSG="say \\"hi\\""', "MSG"), 'say "hi"');
    assert.equal(value('PATH="C:\\\\Users\\\\ada"', "PATH"), "C:\\Users\\ada");
    assert.equal(value('NOTE="line1\\nline2"', "NOTE"), "line1\nline2");
    assert.equal(value('WIN="C:\\temp"', "WIN"), "C:\\temp");
    assert.equal(value('KEEP="\\t"', "KEEP"), "\\t");
  });

  it("treats single quotes as literal", () => {
    assert.equal(value("NOTE='line1\\nline2'", "NOTE"), "line1\\nline2");
    assert.equal(value("PATH='C:\\Users'", "PATH"), "C:\\Users");
    assert.equal(value("EMPTY=''", "EMPTY"), "");
  });

  it("reads multiline quoted values", () => {
    const content = 'CERT="-----BEGIN-----\\nline-two\\n-----END-----"\n';
    assert.equal(value(content, "CERT"), "-----BEGIN-----\nline-two\n-----END-----");

    const multiline = 'BODY="hello\nworld"\nNEXT=1\n';
    const parsed = parseEnv(multiline);
    assert.equal(parsed.values.get("BODY")?.value, "hello\nworld");
    assert.equal(parsed.values.get("BODY")?.line, 1);
    assert.equal(parsed.values.get("BODY")?.endLine, 2);
    assert.equal(parsed.values.get("NEXT")?.value, "1");
    assert.equal(parsed.values.get("NEXT")?.line, 3);
  });

  it("preserves a hash inside quotes", () => {
    assert.equal(value('TITLE="issue #12"', "TITLE"), "issue #12");
    assert.equal(value("TITLE='issue #12'", "TITLE"), "issue #12");
  });

  it("marks optional keys from the previous comment or an inline comment", () => {
    const content = [
      "# optional",
      "SENTRY_DSN=",
      "",
      "# Optional: analytics",
      "ANALYTICS_ID=public",
      "",
      "# @optional",
      "FLAG=1",
      "",
      "INLINE= # optional",
      'QUOTED="x" # @optional',
      "REQUIRED=1",
    ].join("\n");
    const parsed = parseEnv(content);
    for (const key of ["SENTRY_DSN", "ANALYTICS_ID", "FLAG", "INLINE", "QUOTED"]) {
      assert.equal(parsed.values.get(key)?.optional, true, key);
    }
    assert.equal(parsed.values.get("REQUIRED")?.optional, false);
  });

  it("does not treat a nearby comment as an optional marker", () => {
    const content =
      "# optional\n# database url\nDATABASE_URL=postgres\n# optionally document this\nOTHER=1\n";
    const parsed = parseEnv(content);
    assert.equal(parsed.values.get("DATABASE_URL")?.optional, false);
    assert.equal(parsed.values.get("OTHER")?.optional, false);
  });

  it("keeps an optional marker across a blank line and consumes it on an invalid line", () => {
    const kept = parseEnv("# optional\n\nMAYBE=\n");
    assert.equal(kept.values.get("MAYBE")?.optional, true);

    const consumed = parseEnv("# optional\nNOT VALID\nKEY=1\n");
    assert.equal(consumed.values.get("KEY")?.optional, false);
    assert.equal(consumed.issues[0]?.line, 2);
  });

  it("lets the last duplicate win and records every line", () => {
    const parsed = parseEnv("PORT=1\nHOST=localhost\nPORT=2\n");
    assert.equal(parsed.values.get("PORT")?.value, "2");
    assert.deepEqual(parsed.duplicates, [{ key: "PORT", lines: [1, 3] }]);
    assert.equal(parsed.values.get("PORT")?.optional, false);
  });

  it("uses the optional flag from the last duplicate", () => {
    const parsed = parseEnv("PORT=1\n# optional\nPORT=\n");
    assert.equal(parsed.values.get("PORT")?.optional, true);
    assert.equal(parsed.values.get("PORT")?.value, "");
  });

  it("strips a leading BOM and accepts CR, LF, and CRLF", () => {
    assert.equal(value("\uFEFFKEY=value", "KEY"), "value");
    assert.equal(value("A=1\r\nB=2\rC=3\n", "B"), "2");
    assert.equal(value("A=1\r\nB=2\rC=3\n", "C"), "3");
  });

  it("reports invalid lines and invalid names without echoing a value", () => {
    const parsed = parseEnv("GOOD=1\nNOT A PAIR secret-value\n1KEY=nope\nMY-KEY=also-nope\n");
    assert.equal(parsed.values.size, 1);
    assert.deepEqual(
      parsed.issues.map((issue) => issue.message),
      [
        "invalid line (expected KEY=VALUE)",
        'invalid variable name "1KEY"',
        'invalid variable name "MY-KEY"',
      ],
    );
    assert.equal(JSON.stringify(parsed.issues).includes("secret-value"), false);
    assert.equal(JSON.stringify(parsed.issues).includes("nope"), false);
  });

  it("reports an unterminated quote and does not parse the rest of the string as keys", () => {
    const parsed = parseEnv('GOOD=1\nBROKEN="hello\nOTHER=smuggled\n');
    assert.equal(parsed.values.has("OTHER"), false);
    assert.equal(parsed.values.has("BROKEN"), false);
    assert.equal(parsed.issues[0]?.code, "unterminated_quote");
    assert.equal(parsed.issues[0]?.key, "BROKEN");
    assert.equal(parsed.issues[0]?.line, 2);
    assert.equal(parsed.issues.length, 1);
  });

  it("reports trailing junk after a closed quote and does not keep the key", () => {
    const parsed = parseEnv('KEY="value" leftover\n');
    assert.equal(parsed.values.has("KEY"), false);
    assert.equal(parsed.issues[0]?.message, "unexpected trailing content");
    assert.equal(parsed.issues[0]?.key, "KEY");
  });

  it("allows a comment immediately after a closing quote", () => {
    const parsed = parseEnv('KEY="value"# optional\n');
    assert.equal(parsed.values.get("KEY")?.value, "value");
    assert.equal(parsed.values.get("KEY")?.optional, true);
  });

  it("returns no bindings for an empty or comment-only file", () => {
    assert.equal(parseEnv("").values.size, 0);
    assert.equal(parseEnv("# just a comment\n\n").values.size, 0);
  });

  it("keeps quoted whitespace so the checker can decide it is empty", () => {
    assert.equal(value('KEY="   "', "KEY"), "   ");
    assert.equal(value("KEY=", "KEY"), "");
  });
});
