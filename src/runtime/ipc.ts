import { createConnection } from "node:net";
import { record } from "../core/privacy";
import { StringDecoder } from "node:string_decoder";

export interface RpcResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
}
export function rpc(path: string, method: string, payload?: unknown, timeoutMs = 15000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    let buffer = "";
    const decoder = new StringDecoder("utf8");
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Local supervisor did not respond in time"));
    }, timeoutMs);
    socket.on("error", () => {
      clearTimeout(timer);
      reject(new Error("Local supervisor unavailable"));
    });
    socket.on("connect", () => socket.write(JSON.stringify({ method, payload }) + "\n"));
    socket.on("data", (chunk: Buffer) => {
      buffer += decoder.write(chunk);
      if (buffer.length > 8 * 1024 * 1024) {
        socket.destroy();
        clearTimeout(timer);
        reject(new Error("Supervisor response too large"));
        return;
      }
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      clearTimeout(timer);
      socket.destroy();
      try {
        const response = record(JSON.parse(buffer.slice(0, end)));
        if (response.ok !== true)
          reject(new Error(typeof response.error === "string" ? response.error : "Supervisor request failed"));
        else resolve(response.data);
      } catch {
        reject(new Error("Invalid supervisor response"));
      }
    });
  });
}
