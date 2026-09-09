import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

describe("PR privacy gate rejects unsafe changes", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ccs-static-"));
    await mkdir(join(root, "src/runtime"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ commands: [], dependencies: {} }));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function check() {
    return new Promise<number | null>((resolveExit, reject) => {
      const child = spawn(process.execPath, [resolve("scripts/check-privacy.mjs")], {
        cwd: root,
        env: { PATH: "/usr/bin:/bin" },
        shell: false,
        stdio: "ignore",
      });
      child.once("error", reject);
      child.once("close", resolveExit);
    });
  }
  it.each([
    'import { readFile } from "node:fs/promises"; readFile("/arbitrary/path");',
    'import { spawn } from "node:child_process"; spawn("binary", ["--flag"]);',
    "const inherited = process.env;",
    'import * as telemetry from "@sentry/node";',
    'import { request } from "node:https";',
    'const forbidden = "auth.json";',
    'console.log("private prompt");',
  ])("fails closed for forbidden source: %s", async (source) => {
    await writeFile(join(root, "src/example.ts"), source);
    expect(await check()).toBe(1);
  });
  it("rejects unsafe options even within the audited spawn module", async () => {
    await writeFile(
      join(root, "src/runtime/process.ts"),
      'import { spawn } from "node:child_process"; spawn("binary", "interpolated prompt", { shell: true, env: process.env });',
    );
    expect(await check()).toBe(1);
  });
  it("rejects password preferences and unreviewed runtime dependencies", async () => {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        commands: [],
        preferences: [{ name: "key", type: "password" }],
        dependencies: { analytics: "1" },
      }),
    );
    expect(await check()).toBe(1);
  });
});
