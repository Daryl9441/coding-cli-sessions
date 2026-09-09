import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  spawn: vi.fn(),
  probe: vi.fn(),
  candidates: vi.fn(),
  secure: vi.fn(),
  prefs: vi.fn(),
}));
vi.mock("@raycast/api", () => ({ environment: { assetsPath: "/fixture/assets" }, getPreferenceValues: mocks.prefs }));
vi.mock("../src/runtime/ipc", () => ({ rpc: mocks.rpc }));
vi.mock("../src/runtime/process", () => ({ probe: mocks.probe, spawnSupervisor: mocks.spawn }));
vi.mock("../src/adapters/capabilities", () => ({ executableCandidates: mocks.candidates }));
vi.mock("../src/runtime/paths", () => ({
  socketPath: () => "/tmp/fixture.sock",
  runtimeDirectory: () => "/tmp/fixture",
  secureDirectory: mocks.secure,
}));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.prefs.mockReturnValue({
    nodePath: "/fixture/node",
    claudePath: "/fixture/claude",
    codexPath: "/fixture/codex",
  });
  mocks.candidates.mockResolvedValue(["/fixture/node"]);
  mocks.probe.mockResolvedValue({ code: 0, stdout: "v24.19.0" });
  mocks.rpc.mockResolvedValue({});
});

describe("Raycast-to-supervisor client", () => {
  it("reuses an existing supervisor and carries typed commands over local IPC", async () => {
    const { client } = await import("../src/ui/client");
    await client.list();
    await client.stop("id");
    await client.forget("id");
    await client.clearDebug();
    await client.inspect("claude");
    await client.inspect("codex");
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "/tmp/fixture.sock",
      "inspect",
      { engine: "codex", executable: "/fixture/codex" },
      90000,
    );
    expect(mocks.rpc).toHaveBeenCalledWith("/tmp/fixture.sock", "stop", { id: "id" }, 15000);
  });
  it("coalesces concurrent launches into one local supervisor bootstrap", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("not running"));
    const { client } = await import("../src/ui/client");
    await Promise.all([client.list(), client.list()]);
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(mocks.spawn).toHaveBeenCalledWith(
      "/fixture/node",
      "/fixture/assets/supervisor.cjs",
      "/tmp/fixture.sock",
      expect.any(String),
    );
    expect(mocks.secure).toHaveBeenCalledTimes(1);
  });
  it("rejects incompatible Node before launching anything", async () => {
    mocks.rpc.mockRejectedValue(new Error("not running"));
    mocks.probe.mockResolvedValue({ code: 0, stdout: "v18.0.0" });
    const { client } = await import("../src/ui/client");
    await expect(client.list()).rejects.toThrow("Node.js 22+");
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
  it("surfaces failed handshakes instead of claiming that the background process started", async () => {
    mocks.rpc.mockRejectedValue(new Error("not running"));
    const { client } = await import("../src/ui/client");
    await expect(client.list()).rejects.toThrow("Unable to start the local supervisor");
  });
  it("can probe the host Node when no explicit Node path is configured", async () => {
    mocks.prefs.mockReturnValue({});
    mocks.rpc.mockRejectedValueOnce(new Error("not running"));
    const { client } = await import("../src/ui/client");
    await client.list();
    expect(mocks.probe).toHaveBeenCalledWith(process.execPath, ["--version"], expect.any(String), 3000);
  });
});
