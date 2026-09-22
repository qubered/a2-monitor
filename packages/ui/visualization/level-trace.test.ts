import { describe, expect, it } from "vitest";
import { drawTrace, type TraceSample, type TraceTheme } from "./level-trace.js";

const theme: TraceTheme = {
  ok: "#4fd888",
  purple: "#9b82e6",
  inkMuted: "#cdc4b2",
  rep: "#b6ac9a",
  paper: "#141210",
};

class FakeContext {
  calls: string[] = [];
  fillStyle = "";
  strokeStyle = "";
  globalAlpha = 1;
  lineWidth = 1;
  lineJoin = "miter";
  lineCap = "butt";

  clearRect(): void {
    this.calls.push("clearRect");
  }
  fillRect(): void {
    this.calls.push(`fillRect:${this.fillStyle}`);
  }
  beginPath(): void {
    this.calls.push("beginPath");
  }
  moveTo(): void {
    this.calls.push("moveTo");
  }
  lineTo(): void {
    this.calls.push("lineTo");
  }
  stroke(): void {
    this.calls.push(`stroke:${this.strokeStyle}`);
  }
  save(): void {
    this.calls.push("save");
  }
  restore(): void {
    this.calls.push("restore");
  }
  clip(): void {
    this.calls.push("clip");
  }
  rect(): void {
    this.calls.push("rect");
  }
}

describe("drawTrace", () => {
  it("does nothing for an empty sample list", () => {
    const context = new FakeContext();
    drawTrace(context as unknown as CanvasRenderingContext2D, 100, 40, [], {
      min: -60,
      max: 0,
      variant: "bars",
      theme,
      playheadRatio: null,
      replay: false,
    });
    expect(context.calls).toEqual(["clearRect"]);
  });

  it("fills an --ok bar for an observed value and skips a bar for silence", () => {
    const context = new FakeContext();
    const samples: TraceSample[] = [
      { value: -18, availability: "observed" },
      { value: null, availability: "observed" },
    ];
    drawTrace(
      context as unknown as CanvasRenderingContext2D,
      100,
      40,
      samples,
      {
        min: -60,
        max: 0,
        variant: "bars",
        theme,
        playheadRatio: null,
        replay: false,
      },
    );
    expect(context.calls).toContain(`fillRect:${theme.ok}`);
    expect(context.calls).toContain(`fillRect:${theme.inkMuted}`);
  });

  it("uses --purple instead of --ok while in replay", () => {
    const context = new FakeContext();
    const samples: TraceSample[] = [{ value: -18, availability: "observed" }];
    drawTrace(
      context as unknown as CanvasRenderingContext2D,
      100,
      40,
      samples,
      {
        min: -60,
        max: 0,
        variant: "bars",
        theme,
        playheadRatio: null,
        replay: true,
      },
    );
    expect(context.calls).toContain(`fillRect:${theme.purple}`);
    expect(context.calls).not.toContain(`fillRect:${theme.ok}`);
  });

  it("hatches a stale sample instead of drawing a plain bar", () => {
    const context = new FakeContext();
    const samples: TraceSample[] = [{ value: -18, availability: "stale" }];
    drawTrace(
      context as unknown as CanvasRenderingContext2D,
      100,
      40,
      samples,
      {
        min: -60,
        max: 0,
        variant: "bars",
        theme,
        playheadRatio: null,
        replay: false,
      },
    );
    expect(context.calls).toContain("clip");
    expect(context.calls.some((call) => call.startsWith("stroke:"))).toBe(true);
  });

  it("draws a playhead stroke when a ratio is given", () => {
    const context = new FakeContext();
    const samples: TraceSample[] = [{ value: -18, availability: "observed" }];
    drawTrace(
      context as unknown as CanvasRenderingContext2D,
      100,
      40,
      samples,
      {
        min: -60,
        max: 0,
        variant: "bars",
        theme,
        playheadRatio: 0.5,
        replay: false,
      },
    );
    expect(context.calls).toContain(`stroke:${theme.inkMuted}`);
  });
});
