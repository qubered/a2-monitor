import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseRecordingSpans } from "@rvlt/pulse-protocol/http";
import { recordingSpans } from "./recording-spans.js";

const T0 = Date.parse("2026-10-01T10:00:00.000Z");
const roots: string[] = [];

async function recordings(names: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pulse-spans-"));
  roots.push(root);
  await mkdir(join(root, "ch002"));
  for (const name of names) await writeFile(join(root, "ch002", name), "");
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("recordingSpans", () => {
  it("merges continuous segments and leaves real gaps", async () => {
    const root = await recordings([
      `${T0}-0-3000.pseg`, // a full minute
      `${T0 + 60_003}-2880000-3000.pseg`, // 3 ms later: continuous
      `${T0 + 180_000}-0-1500.pseg`, // a minute's gap, then 30 s
      "recording.json", // not a segment
    ]);
    const spans = parseRecordingSpans(
      await recordingSpans(root, 2, T0 + 300_000, 3_600_000),
    );
    expect(spans.channel).toBe(2);
    expect(spans.spans).toEqual([
      {
        startUtc: new Date(T0).toISOString(),
        endUtc: new Date(T0 + 120_003).toISOString(),
      },
      {
        startUtc: new Date(T0 + 180_000).toISOString(),
        endUtc: new Date(T0 + 210_000).toISOString(),
      },
    ]);
  });

  it("drops segments outside the window and tolerates a missing directory", async () => {
    const root = await recordings([`${T0}-0-3000.pseg`]);
    expect(
      (await recordingSpans(root, 2, T0 + 7_200_000, 3_600_000)).spans,
    ).toEqual([]);
    expect((await recordingSpans(root, 9, T0, 3_600_000)).spans).toEqual([]);
  });

  it("ends a segment still being written at its last write, not at now", async () => {
    const started = Date.now() - 120_000;
    const root = await recordings([`${started}-0.pseg`]);
    const { spans } = await recordingSpans(root, 2, Date.now() + 60_000, 1e12);
    expect(spans).toHaveLength(1);
    expect(Date.parse(spans[0]!.endUtc)).toBeLessThanOrEqual(Date.now());
  });
});
