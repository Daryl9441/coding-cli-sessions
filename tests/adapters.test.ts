import { describe, expect, it } from "vitest";
import { adapters, validateSessionId } from "../src/adapters/commands";
import { evaluateCapabilities, executableCandidates, hasFlag, inspectCli } from "../src/adapters/capabilities";
import { probe } from "../src/runtime/process";
import { fixture, request } from "./helpers";

describe("real executable fixture capability checks", () => {
  it.each(["claude", "codex"] as const)(
    "checks %s installation, help, version and login without model calls",
    async (engine) => {
      const cap = await inspectCli(engine, fixture(engine));
      expect(cap.compatible).toBe(true);
      expect(cap.loggedIn).toBe(true);
      expect(cap.version.toLowerCase()).toContain("fixture");
      expect(JSON.stringify(cap)).not.toContain("private@example.invalid");
      expect(JSON.stringify(cap)).not.toContain("sk-" + "f".repeat(32));
    },
  );
  it("reports missing CLI, unsupported flags and unauthenticated CLI", async () => {
    expect((await inspectCli("claude", "/nonexistent/ccs-fixture")).compatible).toBe(false);
    expect((await inspectCli("codex", fixture("incompatible"))).issues.length).toBeGreaterThan(0);
    expect((await inspectCli("claude", fixture("unauthenticated"))).loggedIn).toBe(false);
    await expect(executableCandidates("claude", "relative")).rejects.toThrow("absolute");
    expect(await executableCandidates("node")).toBeInstanceOf(Array);
  });
  it("does not confuse flag prefixes", () => {
    expect(hasFlag("--json-schema --json,", "--json")).toBe(true);
    expect(hasFlag("--json-schema", "--json")).toBe(false);
    expect(evaluateCapabilities("codex", "/fake", "old", {}, false).compatible).toBe(false);
  });
  it("bounds process probe failures and timeouts", async () => {
    expect((await probe("/missing", [], process.cwd())).code).toBe(-1);
    expect((await probe("bad\0path", [], process.cwd())).code).toBe(-1);
    // A process waiting for timers will exceed a zero-duration diagnostics deadline.
    expect((await probe(fixture("claude"), ["--help"], process.cwd(), 0)).timedOut).toBe(true);
  });
});

describe("separate start and resume contracts", () => {
  it.each(["claude", "codex"] as const)(
    "passes %s prompts on stdin with persistence off by default",
    async (engine) => {
      const cap = await inspectCli(engine, fixture(engine));
      const spec = adapters[engine].buildStart(
        request({ engine, prompt: "$(touch not-executed); private prompt" }),
        cap,
      );
      expect(spec.input).toContain("private prompt");
      expect(spec.args.join(" ")).not.toContain("private prompt");
      expect(spec.args).toContain(engine === "claude" ? "--no-session-persistence" : "--ephemeral");
      const persistent = adapters[engine].buildStart(request({ engine, persistSession: true }), cap);
      expect(persistent.args).not.toContain(engine === "claude" ? "--no-session-persistence" : "--ephemeral");
    },
  );
  it("distinguishes all four resume paths", async () => {
    const c = await inspectCli("claude", fixture("claude"));
    const x = await inspectCli("codex", fixture("codex"));
    expect(adapters.claude.buildHeadlessResume(request({ resume: "abc123" }), c).args).toContain("--resume");
    expect(adapters.claude.buildHeadlessResume(request({ resume: "last" }), c).args).toContain("-c");
    const spec = adapters.codex.buildHeadlessResume(request({ engine: "codex", resume: "abc123" }), x);
    expect(spec.args[0]).toBe("exec");
    expect(spec.args).toContain("resume");
    expect(spec.args).toContain("abc123");
    expect(spec.args.at(-1)).toBe("-");
    expect(adapters.codex.buildHeadlessResume(request({ engine: "codex", resume: "last" }), x).args).toContain(
      "--last",
    );
    expect(adapters.claude.buildInteractiveResume("/claude", "id").args).toEqual(["--resume", "id"]);
    expect(adapters.claude.buildInteractiveResume("/claude", "last").args).toEqual(["-c"]);
    expect(adapters.codex.buildInteractiveResume("/codex", "id").args).toEqual(["resume", "id"]);
    expect(adapters.codex.buildInteractiveResume("/codex", "last").args).toEqual(["resume", "--last"]);
  });
  it("rejects unsupported policies and unsafe IDs before spawning", async () => {
    const c = await inspectCli("claude", fixture("claude"));
    const x = await inspectCli("codex", fixture("codex"));
    for (const id of ["--remote", "../path", "foo/bar", ""]) expect(() => validateSessionId(id)).toThrow();
    expect(() => adapters.codex.buildStart(request({ codexApproval: "on-request" }), x)).toThrow("never only");
    expect(() => adapters.claude.buildStart(request(), { ...c, claudePermissions: [] })).toThrow("unsupported");
    expect(() => adapters.claude.buildStart(request(), { ...c, compatible: false })).toThrow("incompatible");
    expect(() => adapters.claude.buildStart(request(), { ...c, loggedIn: false })).toThrow("login");
    const rules = request({ allowedTools: ["Read"], deniedTools: ["Bash(rm *)"] });
    expect(adapters.claude.buildStart(rules, c).args).toContain("Bash(rm *)");
    expect(() => adapters.claude.buildStart(rules, { ...c, help: { main: "" } })).toThrow("support");
  });
});
