import { Buffer } from "node:buffer";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket, { type RawData } from "ws";
import { parseMeterFrame, parseNodeLevels } from "@rvlt/pulse-protocol/http";
import { CaptureManager, type CaptureProcess } from "./capture.js";
import { ListenGateway } from "./server.js";
import { SIMULATED_DEVICE_NAME } from "./simulated-capture.js";

class FakeCaptureProcess implements CaptureProcess {
  readonly stdout = new PassThrough();
  readonly stop = vi.fn();

  onError(): void {}

  onExit(): void {}
}

const gateways = new Set<ListenGateway>();

afterEach(async () => {
  await Promise.all([...gateways].map((gateway) => gateway.close()));
  gateways.clear();
});

function rawDataToBuffer(data: RawData): Buffer {
  return Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
}

describe("ListenGateway", () => {
  it("streams only the selected channel as mono Float32LE", async () => {
    const child = new FakeCaptureProcess();
    const capture = new CaptureManager({
      device: "Test Device",
      processFactory: () => child,
    });
    const gateway = new ListenGateway({ captureManager: capture });
    gateways.add(gateway);
    gateway.startCapture();
    child.stdout.write(
      '{"schemaVersion":0,"deviceName":"Test","sampleRateHz":48000,"channelCount":2}\n',
    );

    gateway.server.listen(0, "127.0.0.1");
    await once(gateway.server, "listening");
    const address = gateway.server.address() as AddressInfo;
    const socket = new WebSocket(
      `ws://127.0.0.1:${address.port}/audio/v0/listen?channel=1`,
    );
    await once(socket, "open");

    const message = once(socket, "message");
    const interleaved = Buffer.alloc(4 * 4);
    [1, 2, 3, 4].forEach((sample, index) =>
      interleaved.writeFloatLE(sample, index * 4),
    );
    child.stdout.write(interleaved.subarray(0, 5));
    child.stdout.write(interleaved.subarray(5));

    const [data, isBinary] = (await message) as [RawData, boolean];
    const mono = rawDataToBuffer(data);
    expect(isBinary).toBe(true);
    expect(mono.byteLength).toBe(8);
    expect([mono.readFloatLE(0), mono.readFloatLE(4)]).toEqual([2, 4]);

    socket.close();
    await once(socket, "close");
  });

  it("reports capture state and an empty level summary before a device is configured", async () => {
    const gateway = new ListenGateway({});
    gateways.add(gateway);
    gateway.server.listen(0, "127.0.0.1");
    await once(gateway.server, "listening");
    const address = gateway.server.address() as AddressInfo;

    const response = await fetch(
      `http://127.0.0.1:${address.port}/audio/v0/levels`,
    );
    const levels = parseNodeLevels(await response.json());
    expect(levels).toMatchObject({
      capture: { status: "configuration-required", device: null },
      windowMs: 1_000,
      inputs: [],
    });
  });

  it("meters the simulated test signal over the levels endpoint and the meter stream", async () => {
    const gateway = new ListenGateway({
      device: SIMULATED_DEVICE_NAME,
      simulatedChannels: 8,
    });
    gateways.add(gateway);
    gateway.startCapture();
    gateway.server.listen(0, "127.0.0.1");
    await once(gateway.server, "listening");
    const address = gateway.server.address() as AddressInfo;

    const socket = new WebSocket(
      `ws://127.0.0.1:${address.port}/audio/v0/meters`,
    );
    await once(socket, "open");
    const [data] = (await once(socket, "message")) as [RawData];
    const frame = parseMeterFrame(JSON.parse(rawDataToBuffer(data).toString()));
    expect(frame.peakDbfs).toHaveLength(8);
    expect(frame.intervalMs).toBe(50);
    // Input 3 is a steady -18 dBFS tone; input 7 is digital silence.
    expect(frame.peakDbfs[2]).toBeCloseTo(-18, 0);
    expect(frame.peakDbfs[6]).toBe(-120);
    socket.close();
    await once(socket, "close");

    const response = await fetch(
      `http://127.0.0.1:${address.port}/audio/v0/levels`,
    );
    const levels = parseNodeLevels(await response.json());
    expect(levels.capture).toEqual({
      status: "ready",
      detail: "Capture is ready.",
      device: {
        name: SIMULATED_DEVICE_NAME,
        sampleRateHz: 48_000,
        channelCount: 8,
        simulated: true,
      },
    });
    expect(levels.inputs).toHaveLength(8);
    expect(levels.inputs[2]?.peakDbfs).toBeCloseTo(-18, 0);
    expect(levels.inputs[6]).toEqual({
      index: 6,
      peakDbfs: -120,
      rmsDbfs: -120,
      clippedSamples: 0,
    });
  });
});
