// Bounded Server-Sent Events parser shared by the audio node (EW-DX SSCv2
// subscriptions) and the backend (the node's receiver telemetry stream).
//
// Follows the EventSource line rules (LF, CRLF or CR line endings; `:` comment
// lines; a blank line dispatches) but keeps only the `event` and `data`
// fields, the only two SSCv2 allows. UTF-8 is decoded as a stream, so a
// character split between chunks is reassembled. Every bound is a hard
// failure: once refused, the parser stays refused and the caller must drop
// the connection rather than resynchronise mid-stream.

export type SseEvent = { event: string; data: string };

export type SseParserOptions = {
  /** Largest event (all its lines together) in bytes. */
  maxEventBytes?: number;
  /** Most events one chunk may complete. */
  maxEventsPerPush?: number;
};

export class SseParserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SseParserError";
  }
}

export class SseParser {
  private readonly decoder = new TextDecoder("utf-8", { fatal: false });
  private readonly maxEventBytes: number;
  private readonly maxEventsPerPush: number;
  private line = "";
  private lastWasCr = false;
  private eventType = "";
  private data: string[] = [];
  private eventBytes = 0;
  private failed: SseParserError | null = null;
  /** Bytes received so far, comments included: proof the stream is alive. */
  bytesReceived = 0;

  constructor(options: SseParserOptions = {}) {
    this.maxEventBytes = options.maxEventBytes ?? 256 * 1024;
    this.maxEventsPerPush = options.maxEventsPerPush ?? 1024;
  }

  push(chunk: Uint8Array): SseEvent[] {
    if (this.failed) throw this.failed;
    this.bytesReceived += chunk.byteLength;
    const text = this.decoder.decode(chunk, { stream: true });
    const events: SseEvent[] = [];
    for (const character of text) {
      if (character === "\n" && this.lastWasCr) {
        this.lastWasCr = false;
        continue;
      }
      this.lastWasCr = character === "\r";
      if (character === "\n" || character === "\r") {
        const event = this.endLine();
        if (event) {
          events.push(event);
          if (events.length > this.maxEventsPerPush)
            this.fail("Too many events in one read.");
        }
        continue;
      }
      this.line += character;
      if (this.line.length > this.maxEventBytes)
        this.fail("Event line exceeds the size limit.");
    }
    return events;
  }

  private fail(message: string): never {
    this.failed = new SseParserError(message);
    throw this.failed;
  }

  private endLine(): SseEvent | null {
    const line = this.line;
    this.line = "";
    if (line === "") {
      const event =
        this.data.length > 0
          ? { event: this.eventType || "message", data: this.data.join("\n") }
          : null;
      this.eventType = "";
      this.data = [];
      this.eventBytes = 0;
      return event;
    }
    this.eventBytes += Buffer.byteLength(line) + 1;
    if (this.eventBytes > this.maxEventBytes)
      this.fail("Event exceeds the size limit.");
    if (line.startsWith(":")) return null;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") this.eventType = value;
    else if (field === "data") this.data.push(value);
    return null;
  }
}
