#!/usr/bin/env node
import { run } from "./run.js";

const code = run(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  stdout: process.stdout,
  stderr: process.stderr,
});

process.exit(code);
