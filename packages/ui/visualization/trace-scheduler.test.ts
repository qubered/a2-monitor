// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { scheduleTraceRedraw } from "./trace-scheduler.js";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

describe("scheduleTraceRedraw", () => {
  it("batches multiple redraws requested before the frame fires", async () => {
    const calls: string[] = [];
    scheduleTraceRedraw(() => calls.push("a"));
    scheduleTraceRedraw(() => calls.push("b"));
    await nextFrame();
    expect(calls).toEqual(["a", "b"]);
  });

  it("never calls a redraw that was cancelled before the frame fires", async () => {
    const calls: string[] = [];
    const cancel = scheduleTraceRedraw(() => calls.push("cancelled"));
    scheduleTraceRedraw(() => calls.push("kept"));
    cancel();
    await nextFrame();
    expect(calls).toEqual(["kept"]);
  });

  it("schedules a fresh frame for redraws requested after a flush", async () => {
    const calls: string[] = [];
    scheduleTraceRedraw(() => calls.push("first"));
    await nextFrame();
    scheduleTraceRedraw(() => calls.push("second"));
    await nextFrame();
    expect(calls).toEqual(["first", "second"]);
  });
});
