import { StringDecoder } from "node:string_decoder";

/** Bounded incremental UTF-8 JSONL framing; malformed / oversize records never become logs. */
export class JsonlDecoder {
  private decoder = new StringDecoder("utf8");
  private pending = "";
  private dropping = false;
  constructor(
    private onValue: (value: unknown) => void,
    private onInvalid: () => void,
    private maxLength = 1024 * 1024,
  ) {}

  push(chunk: Buffer): void {
    const text = this.decoder.write(chunk);
    for (const part of text.split(/(?<=\n)/)) {
      if (!this.dropping) this.pending += part;
      if (this.pending.length > this.maxLength) {
        this.pending = "";
        this.dropping = true;
        this.onInvalid();
      }
      if (part.endsWith("\n")) {
        if (!this.dropping) this.parse(this.pending);
        this.pending = "";
        this.dropping = false;
      }
    }
  }

  end(): void {
    this.pending += this.decoder.end();
    if (!this.dropping) this.parse(this.pending);
    this.pending = "";
    this.dropping = false;
  }

  private parse(line: string): void {
    if (!line.trim()) return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      this.onInvalid();
      return;
    }
    this.onValue(value);
  }
}
