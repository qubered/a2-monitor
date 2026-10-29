import { describe, expect, it } from "vitest";
import { SseParser, SseParserError } from "../sse/sse-parser";

const encode = (text: string) => Buffer.from(text, "utf8");

describe("SseParser", () => {
  it("dispatches events on a blank line with the default message type", () => {
    const parser = new SseParser();
    expect(parser.push(encode('data: {"a":1}\n\n'))).toEqual([
      { event: "message", data: '{"a":1}' },
    ]);
  });

  it("reads named events and joins multi-line data with newlines", () => {
    const parser = new SseParser();
    expect(
      parser.push(encode("event: open\ndata: one\ndata: two\n\n")),
    ).toEqual([{ event: "open", data: "one\ntwo" }]);
  });

  it("reassembles events split across arbitrary chunk boundaries", () => {
    const text = 'event: open\ndata: {"x":"y"}\n\ndata: {"b":2}\n\n';
    for (let size = 1; size <= text.length; size += 1) {
      const parser = new SseParser();
      const events = [];
      for (let i = 0; i < text.length; i += size)
        events.push(...parser.push(encode(text.slice(i, i + size))));
      expect(events).toEqual([
        { event: "open", data: '{"x":"y"}' },
        { event: "message", data: '{"b":2}' },
      ]);
    }
  });

  it("decodes UTF-8 characters split between chunks", () => {
    const bytes = encode("data: Grüße €\n\n");
    const parser = new SseParser();
    const events = [];
    for (const byte of bytes) events.push(...parser.push(Buffer.from([byte])));
    expect(events).toEqual([{ event: "message", data: "Grüße €" }]);
  });

  it("accepts CRLF and CR line endings", () => {
    const parser = new SseParser();
    expect(
      parser.push(encode("data: a\r\n\r\ndata: b\r\rdata: c\n\n")),
    ).toEqual([
      { event: "message", data: "a" },
      { event: "message", data: "b" },
      { event: "message", data: "c" },
    ]);
  });

  it("ignores comments, unknown fields, id and retry, and events without data", () => {
    const parser = new SseParser();
    expect(
      parser.push(
        encode(
          ": keepalive\n\nid: 7\nretry: 10\nfoo: bar\nevent: close\n\ndata:x\n\n",
        ),
      ),
    ).toEqual([{ event: "message", data: "x" }]);
  });

  it("reports how many bytes it has received, so a quiet stream is distinguishable from a dead one", () => {
    const parser = new SseParser();
    parser.push(encode(": keepalive\n\n"));
    expect(parser.bytesReceived).toBe(13);
  });

  it("refuses an event larger than its bound and stays refused", () => {
    const parser = new SseParser({ maxEventBytes: 64 });
    expect(() => parser.push(encode(`data: ${"x".repeat(100)}`))).toThrow(
      SseParserError,
    );
    expect(() => parser.push(encode("\n\n"))).toThrow(SseParserError);
  });

  it("refuses a single unterminated line larger than its bound", () => {
    const parser = new SseParser({ maxEventBytes: 64 });
    expect(() => parser.push(encode("x".repeat(65)))).toThrow(SseParserError);
  });

  it("refuses more events in one chunk than its bound", () => {
    const parser = new SseParser({ maxEventsPerPush: 2 });
    expect(() =>
      parser.push(encode("data: 1\n\ndata: 2\n\ndata: 3\n\n")),
    ).toThrow(SseParserError);
  });
});
