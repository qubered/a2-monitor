// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MouseEvent } from "react";
import type { LiveStateChannel } from "@rvlt/pulse-protocol/http";
import { ChannelCard } from "./ChannelCard";
import { MeterStore } from "../meters";

afterEach(cleanup);

function channel(overrides: Partial<LiveStateChannel> = {}): LiveStateChannel {
  return {
    id: "ch-1",
    number: 1,
    name: "Podium",
    performer: "Dana Lee",
    kind: "wireless",
    micType: null,
    micTypeSource: null,
    hasImage: false,
    input: { index: 0, label: "input 1" },
    receiver: null,
    monitor: { battery: true, rf: true, audio: true },
    statuses: { rf: "good", audio: "good", battery: "good", check: "unknown" },
    audio: {
      availability: "observed",
      peakDbfs: -12,
      rmsDbfs: -30,
      silentForMs: 0,
      clipping: false,
    },
    rf: {
      availability: "observed",
      levelDbm: -58,
      linkQualityPercent: 100,
      activeAntenna: "A",
      interference: "none",
      transmitterPresent: true,
    },
    battery: {
      availability: "observed",
      percent: 90,
      bars: 5,
      runtimeMinutes: 270,
      type: "LION",
    },
    transmitter: {
      type: "AD2",
      name: "PODIUM",
      muted: false,
      observedAtUtc: "2026-09-23T01:00:00Z",
    },
    check: null,
    ...overrides,
  };
}

function renderCard(
  overrides: Partial<LiveStateChannel> = {},
  handlers: {
    onSelect?: (event: MouseEvent<HTMLButtonElement>) => void;
    onLongPressSelect?: () => void;
  } = {},
) {
  render(
    <ChannelCard
      channel={channel(overrides)}
      alert={null}
      overlayExpiryMs={300_000}
      nowMs={0}
      selected={false}
      listening={false}
      imageRevision={0}
      meterStore={new MeterStore(null)}
      metersStale={false}
      onAcknowledge={() => {}}
      onSelect={handlers.onSelect ?? (() => {})}
      onLongPressSelect={handlers.onLongPressSelect}
      onOpenDetail={() => {}}
    />,
  );
}

describe("ChannelCard photo fallback", () => {
  it("shows the plain empty frame when no photo and no mic type is known", () => {
    renderCard({ micType: null, micTypeSource: null });
    expect(screen.getByText("Photo not added")).not.toBeNull();
  });

  it("shows a confirmed mic-type glyph without 'likely' when the operator set it", () => {
    renderCard({ micType: "handheld", micTypeSource: "operator" });
    expect(screen.getByText("Handheld")).not.toBeNull();
  });

  it("marks a telemetry-detected mic type as inferred with 'likely'", () => {
    renderCard({ micType: "beltpack", micTypeSource: "inferred" });
    expect(screen.getByText("Likely beltpack")).not.toBeNull();
  });
});

describe("ChannelCard touch multi-select", () => {
  it("a sustained touch press starts multi-select and swallows the click that follows it", () => {
    vi.useFakeTimers();
    try {
      const onSelect = vi.fn();
      const onLongPressSelect = vi.fn();
      renderCard({}, { onSelect, onLongPressSelect });
      const button = screen.getByRole("button", { name: /Select Podium/ });

      fireEvent.pointerDown(button, {
        pointerType: "touch",
        clientX: 10,
        clientY: 10,
      });
      vi.advanceTimersByTime(600);
      expect(onLongPressSelect).toHaveBeenCalledOnce();

      // The browser still dispatches the click on release; it must not also
      // reach onSelect as a second, separate press.
      fireEvent.pointerUp(button, { pointerType: "touch" });
      fireEvent.click(button);
      expect(onSelect).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a plain tap released before the hold threshold reaches onSelect instead", () => {
    vi.useFakeTimers();
    try {
      const onSelect = vi.fn();
      const onLongPressSelect = vi.fn();
      renderCard({}, { onSelect, onLongPressSelect });
      const button = screen.getByRole("button", { name: /Select Podium/ });

      fireEvent.pointerDown(button, {
        pointerType: "touch",
        clientX: 10,
        clientY: 10,
      });
      fireEvent.pointerUp(button, { pointerType: "touch" });
      fireEvent.click(button);
      vi.advanceTimersByTime(600);

      expect(onLongPressSelect).not.toHaveBeenCalled();
      expect(onSelect).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a press that drifts before the threshold cancels the hold instead of selecting", () => {
    vi.useFakeTimers();
    try {
      const onLongPressSelect = vi.fn();
      renderCard({}, { onLongPressSelect });
      const button = screen.getByRole("button", { name: /Select Podium/ });

      fireEvent.pointerDown(button, {
        pointerType: "touch",
        clientX: 10,
        clientY: 10,
      });
      fireEvent.pointerMove(button, {
        pointerType: "touch",
        clientX: 40,
        clientY: 40,
      });
      vi.advanceTimersByTime(600);
      expect(onLongPressSelect).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a mouse press, since Ctrl/Shift already cover the same gesture there", () => {
    vi.useFakeTimers();
    try {
      const onLongPressSelect = vi.fn();
      renderCard({}, { onLongPressSelect });
      const button = screen.getByRole("button", { name: /Select Podium/ });

      fireEvent.pointerDown(button, {
        pointerType: "mouse",
        clientX: 10,
        clientY: 10,
      });
      vi.advanceTimersByTime(600);
      expect(onLongPressSelect).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
