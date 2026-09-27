// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { parseLiveState, type LiveState } from "@rvlt/pulse-protocol/http";
import { diffLiveState } from "@rvlt/pulse-protocol/live-state-delta";
import fixture from "../../../packages/protocol/fixtures/v0/http/current/live-state.valid.json";
import { createEventSourceLiveState } from "./live-state";

class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    super();
    FakeEventSource.instances.push(this);
  }
  emit(type: string, id: number, data: unknown) {
    this.dispatchEvent(
      new MessageEvent(type, {
        data: JSON.stringify(data),
        lastEventId: String(id),
      }),
    );
  }
  close() {
    this.closed = true;
  }
}

describe("createEventSourceLiveState", () => {
  it("applies deltas to the last state and reconnects when one does not fit", () => {
    FakeEventSource.instances = [];
    const first = parseLiveState(fixture);
    const second = structuredClone(first);
    second.revision = first.revision + 1;
    second.channels[0]!.rf = { ...second.channels[0]!.rf, levelDbm: -70 };
    const states: LiveState[] = [];
    const source = createEventSourceLiveState(
      FakeEventSource as unknown as new (url: string) => EventSource,
    );
    const stop = source.subscribe({
      onState: (state) => states.push(state),
      onConnection: vi.fn(),
    });
    const stream = FakeEventSource.instances[0]!;

    stream.emit("state", first.revision, first);
    stream.emit(
      "delta",
      second.revision,
      diffLiveState(first, first.revision, second, second.revision),
    );
    expect(states).toEqual([first, second]);

    // A delta against a state this side never had: drop it, start over.
    stream.emit("delta", 99, diffLiveState(first, 42, second, 99));
    expect(states).toHaveLength(2);
    expect(stream.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(2);
    stop();
    expect(FakeEventSource.instances[1]!.closed).toBe(true);
  });
});
