import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { RecordingSpan, RecordingSpans } from "@rvlt/pulse-protocol/http";

/** Each segment holds at most this long (one minute of 20 ms packets). */
const PACKET_MS = 20;
/** Gaps shorter than this are segment-boundary jitter, not missing audio. */
const CONTINUOUS_GAP_MS = 100;

const SEGMENT_NAME = /^(\d{13})-\d+(?:-(\d+))?\.pseg$/;

type Segment = { startMs: number; endMs: number };

/**
 * The stretches of one input the node holds recorded audio for, read from the
 * segment file names alone: a finished segment's name carries its packet
 * count, and one still being written ends at its last write. Spans within
 * `windowMs` of `nowMs` only, oldest first, with continuous segments merged.
 */
export async function recordingSpans(
  recordingDirectory: string,
  channel: number,
  nowMs: number,
  windowMs: number,
): Promise<RecordingSpans> {
  const directory = join(
    recordingDirectory,
    `ch${String(channel).padStart(3, "0")}`,
  );
  let names: string[] = [];
  try {
    names = await readdir(directory);
  } catch {
    // No directory: nothing has been recorded for this input.
  }
  const segments: Segment[] = [];
  for (const name of names) {
    const match = SEGMENT_NAME.exec(name);
    if (!match?.[1]) continue;
    const startMs = Number(match[1]);
    let endMs: number;
    if (match[2] !== undefined) {
      endMs = startMs + Number(match[2]) * PACKET_MS;
    } else {
      try {
        endMs = Math.min(nowMs, (await stat(join(directory, name))).mtimeMs);
      } catch {
        continue; // deleted by retention while listing
      }
    }
    if (endMs > startMs && endMs >= nowMs - windowMs) {
      segments.push({ startMs, endMs });
    }
  }
  segments.sort((a, b) => a.startMs - b.startMs);

  const spans: RecordingSpan[] = [];
  let open: Segment | undefined;
  const flush = () => {
    if (open) {
      spans.push({
        startUtc: new Date(open.startMs).toISOString(),
        endUtc: new Date(open.endMs).toISOString(),
      });
    }
  };
  for (const segment of segments) {
    if (open && segment.startMs - open.endMs < CONTINUOUS_GAP_MS) {
      open.endMs = Math.max(open.endMs, segment.endMs);
    } else {
      flush();
      open = { ...segment };
    }
  }
  flush();
  return {
    schemaVersion: "0",
    channel,
    generatedAtUtc: new Date(nowMs).toISOString(),
    spans: spans.slice(-3600),
  };
}
