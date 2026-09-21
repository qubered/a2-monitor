import { Buffer } from "node:buffer";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket, { type RawData } from "ws";
import { CaptureManager, type CaptureProcess } from "./capture.js";
import { ListenGateway } from "./server.js";

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
});
