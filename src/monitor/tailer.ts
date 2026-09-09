import { StringDecoder } from "node:string_decoder";
import { openSession, SessionFile } from "./files";

/** Polling works with atomic replacement, deletion, truncation, split JSON and UTF-8 writes. */
export class SessionTailer {
  private offset = 0;
  private inode = -1;
  private pending = "";
  private decoder = new StringDecoder("utf8");
  constructor(
    private home: string,
    readonly file: SessionFile,
    private maxBytes = 512000,
  ) {}

  async poll(onValue: (value: unknown) => void): Promise<boolean> {
    let handle;
    try {
      handle = await openSession(this.home, this.file.engine, this.file.path);
      const stat = await handle.stat();
      if (stat.ino !== this.inode || stat.size < this.offset) {
        this.offset = 0;
        this.pending = "";
        this.decoder = new StringDecoder("utf8");
        this.inode = stat.ino;
      }
      let skipFragment = false;
      if (stat.size - this.offset > this.maxBytes) {
        if (this.offset === 0) {
          // Read metadata near the beginning before jumping to the bounded latest tail.
          const head = Buffer.alloc(16000);
          const { bytesRead } = await handle.read(head, 0, head.length, 0);
          this.consume(head.subarray(0, bytesRead), onValue);
        }
        this.offset = stat.size - this.maxBytes;
        this.pending = "";
        this.decoder = new StringDecoder("utf8");
        skipFragment = true;
      }
      const buffer = Buffer.alloc(Math.min(this.maxBytes, stat.size - this.offset));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, this.offset);
      this.offset += bytesRead;
      let chunk = buffer.subarray(0, bytesRead);
      if (skipFragment) {
        const newline = chunk.indexOf(10);
        chunk = newline >= 0 ? chunk.subarray(newline + 1) : Buffer.alloc(0);
      }
      this.consume(chunk, onValue);
      this.file.mtime = stat.mtimeMs;
      return true;
    } catch {
      return false;
    } finally {
      await handle?.close();
    }
  }

  private consume(buffer: Buffer, onValue: (value: unknown) => void): void {
    this.pending += this.decoder.write(buffer);
    const lines = this.pending.split("\n");
    this.pending = lines.pop() ?? "";
    if (this.pending.length > this.maxBytes) this.pending = "";
    for (const line of lines) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      onValue(parsed);
    }
  }
}
