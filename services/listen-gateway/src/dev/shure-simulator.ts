import { createServer, type Server, type Socket } from "node:net";
import process from "node:process";

/**
 * Development-only Axient Digital AD4Q double for exercising telemetry and
 * alerts without receiver hardware. It answers the same read-only `GET`
 * command strings the gateway sends and pushes unsolicited `REP` frames as
 * scripted values change. Nothing here is evidence about a physical receiver.
 *
 * Scripted behaviour, repeating:
 * - channel 1 is healthy and drains slowly;
 * - channel 2 starts low and drains through the caution and critical limits;
 * - channel 3 dips in RF level and reports interference periodically;
 * - channel 4 loses its transmitter for 20 s of every 80 s and mutes briefly.
 */

type SimulatedChannel = {
  name: string;
  txModel: string;
  present: boolean;
  rssiDbm: number;
  quality: number;
  antenna: string;
  batteryPercent: number;
  muted: boolean;
  interference: boolean;
  audioPeakDbfs: number;
  frequency: string;
  groupChannel: string;
};

const UNKNOWN_BYTE = 255;
const UPDATE_MS = 250;

function pad(value: number, width = 3): string {
  return String(Math.max(0, Math.round(value))).padStart(width, "0");
}

function jitter(time: number, seed: number, amplitude: number): number {
  return (
    Math.sin(time * 0.9 + seed) * amplitude * 0.6 +
    Math.sin(time * 2.3 + seed * 3) * amplitude * 0.4
  );
}

export function scriptedChannels(elapsedSeconds: number): SimulatedChannel[] {
  const t = elapsedSeconds;
  const speech = (seed: number) =>
    -18 +
    10 * Math.abs(Math.sin(t * 4.6 + seed)) -
    (Math.sin(t * 0.7 + seed) > 0.6 ? 40 : 0);

  const ch3CriticalDip = t % 180 >= 120 && t % 180 < 132;
  const ch3CautionDip = t % 90 >= 30 && t % 90 < 45;
  const ch4Present = t % 80 < 60;
  const ch4Muted = ch4Present && t % 100 >= 20 && t % 100 < 35;

  return [
    {
      name: "LEAD VOCAL",
      txModel: "AD2",
      present: true,
      rssiDbm: -55 + jitter(t, 1, 4),
      quality: 5,
      antenna: Math.floor(t / 13) % 2 === 0 ? "BX" : "XB",
      batteryPercent: Math.max(5, 100 - t / 18),
      muted: false,
      interference: false,
      audioPeakDbfs: speech(0.3),
      frequency: "0578125",
      groupChannel: "1,4",
    },
    {
      name: "PRESENTER",
      txModel: "AD1",
      present: true,
      rssiDbm: -60 + jitter(t, 2, 3),
      quality: 5,
      antenna: Math.floor(t / 17) % 2 === 0 ? "XB" : "BX",
      batteryPercent: Math.max(3, 32 - t / 10),
      muted: false,
      interference: false,
      audioPeakDbfs: speech(1.7),
      frequency: "0580550",
      groupChannel: "1,7",
    },
    {
      name: "GUITAR",
      txModel: "AD1",
      present: true,
      rssiDbm: ch3CriticalDip
        ? -94 + jitter(t, 3, 1)
        : ch3CautionDip
          ? -86 + jitter(t, 3, 1.5)
          : -62 + jitter(t, 3, 3),
      quality: ch3CriticalDip ? 1 : ch3CautionDip ? 2 : 5,
      antenna: "BX",
      batteryPercent: Math.max(5, 88 - t / 30),
      muted: false,
      interference: t % 120 >= 60 && t % 120 < 70,
      audioPeakDbfs: -14 + jitter(t * 3, 3, 6),
      frequency: "0583300",
      groupChannel: "1,11",
    },
    {
      name: "HOST",
      txModel: ch4Present ? "ADX1" : "UNKNOWN",
      present: ch4Present,
      rssiDbm: ch4Present ? -58 + jitter(t, 4, 4) : -120,
      quality: ch4Present ? 4 : UNKNOWN_BYTE,
      antenna: ch4Present ? "BX" : "XX",
      batteryPercent: Math.max(5, 64 - t / 40),
      muted: ch4Muted,
      interference: false,
      audioPeakDbfs: ch4Present && !ch4Muted ? speech(4.1) : -120,
      frequency: "0585025",
      groupChannel: "1,15",
    },
  ];
}

/** Command-string values for one channel, keyed by the Axient Digital property names the gateway polls. */
export function channelProperties(
  channel: SimulatedChannel,
): Record<string, string> {
  const battery = channel.present ? channel.batteryPercent : UNKNOWN_BYTE;
  return {
    CHAN_NAME: `{${channel.name}}`,
    FREQUENCY: channel.frequency,
    GROUP_CHANNEL: `{${channel.groupChannel}}`,
    TX_MODEL: channel.txModel,
    TX_MUTE_MODE_STATUS: channel.present
      ? channel.muted
        ? "MUTE"
        : "UNMUTE"
      : "UNKN",
    TX_BATT_BARS: channel.present
      ? pad(Math.min(5, Math.ceil(channel.batteryPercent / 20)))
      : pad(UNKNOWN_BYTE),
    TX_BATT_CHARGE_PERCENT: pad(battery),
    TX_BATT_MINS: channel.present
      ? pad(channel.batteryPercent * 3, 5)
      : "65535",
    TX_BATT_TYPE: channel.present ? "LION" : "UNKN",
    TX_BATT_CYCLE_COUNT: channel.present ? pad(42, 5) : "65535",
    ANTENNA_STATUS: channel.antenna,
    RSSI: pad(channel.rssiDbm + 120),
    CHAN_QUALITY: pad(channel.quality),
    INTERFERENCE_STATUS: channel.interference ? "DETECTED" : "NONE",
    AUDIO_LEVEL_PEAK: pad(Math.max(0, channel.audioPeakDbfs + 120)),
  };
}

const METERED = new Set(["RSSI", "AUDIO_LEVEL_PEAK"]);

export function startShureSimulator(
  host = "127.0.0.1",
  port = 2202,
  now: () => number = Date.now,
): Promise<Server> {
  const startedAt = now();
  const sockets = new Set<Socket>();
  const current = () => scriptedChannels((now() - startedAt) / 1000);
  let last = current().map(channelProperties);

  const timer = setInterval(() => {
    const next = current().map(channelProperties);
    for (const socket of sockets) {
      next.forEach((properties, index) => {
        for (const [property, value] of Object.entries(properties)) {
          if (METERED.has(property) || last[index]?.[property] !== value) {
            socket.write(`< REP ${index + 1} ${property} ${value} >`);
          }
        }
      });
    }
    last = next;
  }, UPDATE_MS);
  timer.unref();

  const server = createServer((socket) => {
    sockets.add(socket);
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      if (buffer.length > 64 * 1024) {
        socket.destroy();
        return;
      }
      let end = buffer.indexOf(">");
      while (end >= 0) {
        const command = buffer.slice(0, end + 1).trim();
        buffer = buffer.slice(end + 1);
        const reply = respond(command, current());
        if (reply) socket.write(reply);
        end = buffer.indexOf(">");
      }
    });
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => sockets.delete(socket));
  });
  server.on("close", () => clearInterval(timer));

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}

function respond(command: string, channels: SimulatedChannel[]): string | null {
  const match =
    /^<\s*(GET|SET)\s+(?:(\d+)\s+)?([A-Z0-9_]+)(?:\s+(.+?))?\s*>$/.exec(
      command.slice(command.indexOf("<")),
    );
  if (!match) return null;
  const [, verb, rawChannel, property, value] = match;
  if (rawChannel === undefined) {
    if (property === "MODEL") return "< REP MODEL {AD4Q} >";
    if (property === "FW_VER") return "< REP FW_VER {2.3.28.0} >";
    return null;
  }
  const channel = channels[Number(rawChannel) - 1];
  if (!channel) return null;
  if (verb === "SET") {
    return property === "METER_RATE"
      ? `< REP ${rawChannel} METER_RATE ${value ?? "00000"} >`
      : null;
  }
  const reported = channelProperties(channel)[property!];
  return reported === undefined
    ? null
    : `< REP ${rawChannel} ${property} ${reported} >`;
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isEntryPoint) {
  const host = process.env.SHURE_SIM_HOST ?? "127.0.0.1";
  const port = Number(process.env.SHURE_SIM_PORT ?? "2202");
  const server = await startShureSimulator(host, port);
  process.stdout.write(
    `Simulated Shure AD4Q (4 channels) on ${host}:${port}. Add it in Manager as an AD4Q at ${host}. Development only.\n`,
  );
  const stop = () => server.close(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
