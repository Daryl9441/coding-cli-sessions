import { spawn } from "node:child_process";

export async function runFixture(engine, options = {}) {
  const args = process.argv.slice(2);
  if (args.includes("--version")) {
    process.stdout.write(engine === "claude" ? "2.1.114 (Fixture)\n" : "codex-cli 0.153.4-fixture\n");
    return;
  }
  if (args.includes("--help")) {
    if (options.incompatible) {
      process.stdout.write("Old incompatible CLI\n");
      return;
    }
    process.stdout.write(
      engine === "claude"
        ? '--print --output-format --include-partial-messages --verbose --resume --no-session-persistence --allowedTools --disallowedTools --json\n--permission-mode (choices: "default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions")\n'
        : args[0] === "exec"
          ? "--json --sandbox --ephemeral --config --last\n"
          : "--json --sandbox --ephemeral --config --last --ask-for-approval\nstatus\n",
    );
    return;
  }
  if (args.includes("status")) {
    if (engine === "claude")
      process.stdout.write(
        JSON.stringify({
          loggedIn: !options.unauthenticated,
          email: "private@example.invalid",
          token: "sk-" + "f".repeat(32),
        }),
      );
    else process.stderr.write(options.unauthenticated ? "Not logged in\n" : "Logged in using a saved account\n");
    process.exitCode = options.unauthenticated ? 1 : 0;
    return;
  }
  let prompt = "";
  for await (const chunk of process.stdin) prompt += chunk;
  const emit = (value) => process.stdout.write(JSON.stringify(value) + "\n");
  const progress = (text) =>
    emit(
      engine === "claude"
        ? { type: "assistant", message: { content: [{ type: "text", text }] } }
        : { type: "item.completed", item: { type: "agent_message", text } },
    );
  const finish = () =>
    emit(
      engine === "claude"
        ? { type: "result", result: "Fixture task complete", is_error: false }
        : { type: "turn.completed" },
    );
  emit(
    engine === "claude"
      ? { type: "system", subtype: "init", session_id: "11111111-1111-4111-8111-111111111111" }
      : { type: "thread.started", thread_id: "22222222-2222-4222-8222-222222222222" },
  );
  if (prompt === "hang") {
    setInterval(() => {}, 1000);
    return;
  }
  if (prompt === "ignore-term") {
    process.on("SIGTERM", () => {});
    setInterval(() => {}, 1000);
    return;
  }
  if (prompt === "large-stream") {
    for (let index = 0; index < 400; index++) {
      emit({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: `tool-${index}-${"x".repeat(1000)}` }] },
      });
    }
    finish();
    return;
  }
  if (prompt === "killed") {
    setTimeout(() => process.kill(process.pid, "SIGKILL"), 60);
    return;
  }
  if (prompt === "missing-result") return;
  if (prompt === "failure") {
    emit(
      engine === "claude"
        ? { type: "result", is_error: true, result: "failed" }
        : { type: "turn.failed", error: { message: "Fixture failed" } },
    );
    process.exitCode = 1;
    return;
  }
  if (prompt === "environment") {
    progress(
      JSON.stringify({
        inheritedSecret: Boolean(process.env.CCS_TEST_SECRET),
        keys: Object.keys(process.env).filter((key) => /TOKEN|KEY|SECRET/.test(key)),
      }),
    );
    finish();
    return;
  }
  if (prompt === "child-tree") {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      shell: false,
      env: { PATH: "/usr/bin:/bin" },
      stdio: "ignore",
    });
    progress(`child-pid:${child.pid}`);
    process.on("SIGTERM", () => {
      if (child.exitCode !== null || child.signalCode !== null) process.exit();
      else child.once("exit", () => process.exit());
    });
    setInterval(() => {}, 1000);
    return;
  }
  if (prompt === "slow") {
    progress("Inspecting local fixture files…");
    setTimeout(() => {
      progress("Validated parser behavior.\nNo external API calls were made.");
      finish();
    }, 3000);
    return;
  }
  if (prompt === "chunks") {
    const line =
      JSON.stringify(
        engine === "claude"
          ? { type: "assistant", message: { content: [{ type: "text", text: "你好 fixture" }] } }
          : { type: "item.completed", item: { type: "agent_message", text: "你好 fixture" } },
      ) + "\n";
    for (const byte of Buffer.from(line)) process.stdout.write(Buffer.from([byte]));
    process.stdout.write("not JSON\n");
    progress("sk-" + "z".repeat(30));
    finish();
    return;
  }
  progress("Fixture work in progress");
  finish();
}
