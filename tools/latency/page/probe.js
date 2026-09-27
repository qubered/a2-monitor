// Reproduces apps/live/src/audio-playback.ts's listen chain closely enough to
// time it, and taps the signal just before the destination. Query parameters:
//   chain=webaudio (Live's chain) | element (plain <audio>, no Web Audio)
//   jbt=<ms>        set RTCRtpReceiver.jitterBufferTarget
//   channel=<n>     input to listen to (0 = bursts, 1 = tone)
const params = new URLSearchParams(location.search);
const chain = params.get("chain") ?? "webaudio";
const jbt = params.get("jbt");
const out = document.getElementById("log");
const results = {
  chain,
  jbt,
  detections: [],
  stats: [],
  errors: [],
  switches: [],
};
window.results = results;

const WORKLET = `
class Onset extends AudioWorkletProcessor {
  constructor() { super(); this.quiet = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        if (Math.abs(ch[i]) > 0.1) {
          if (this.quiet > 4410) this.port.postMessage({ frame: currentFrame + i });
          this.quiet = 0;
        } else this.quiet++;
      }
    }
    return true;
  }
}
registerProcessor("onset", Onset);`;

let session;
let pc;
async function main() {
  const context = new AudioContext({ latencyHint: "interactive" });
  results.baseLatency = context.baseLatency;
  pc = new RTCPeerConnection({
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
  });
  const transceiver = pc.addTransceiver("audio", { direction: "recvonly" });
  // Everything the chain needs is ready before signalling, and playback is
  // attached the moment the track arrives, as Live does. Attaching only after
  // the track unmutes lets packets pile up in the jitter buffer first and
  // shows a start-up delay Live does not have.
  let tap;
  if (chain === "webaudio") {
    const blob = URL.createObjectURL(
      new Blob([WORKLET], { type: "text/javascript" }),
    );
    await context.audioWorklet.addModule(blob);
  }
  const trackReady = new Promise(
    (resolve) =>
      (pc.ontrack = (e) => {
        const stream = new MediaStream([e.track]);
        const element = new Audio();
        element.srcObject = stream;
        if (chain === "webaudio") {
          element.muted = true; // Live keeps the element muted; Web Audio is the audible path
          void element.play().catch(() => undefined);
          const source = context.createMediaStreamSource(stream);
          const gain = context.createGain();
          gain.gain.value = 1;
          tap = new AudioWorkletNode(context, "onset");
          source.connect(gain);
          gain.connect(context.destination);
          gain.connect(tap);
          tap.port.onmessage = ({ data }) => {
            const stamp = context.getOutputTimestamp();
            const frameTime = data.frame / context.sampleRate;
            results.detections.push({
              // When the browser says this sample leaves for the output device.
              outputWallMs:
                performance.timeOrigin +
                stamp.performanceTime +
                (frameTime - stamp.contextTime) * 1000,
              receivedWallMs: performance.timeOrigin + performance.now(),
            });
          };
          void context.resume();
        } else {
          element.muted = false;
          void element
            .play()
            .catch((error) => results.errors.push(String(error)));
          void context.close();
        }
        resolve(e.track);
      }),
  );
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  results.offer = pc.localDescription.sdp;
  const t0 = performance.now();
  const response = await fetch("/audio/v0/listen/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      channel: Number(params.get("channel") ?? 0),
      offer: pc.localDescription.sdp,
    }),
  });
  const body = await response.json();
  session = body.sessionId;
  results.answer = body.answer;
  let answer = body.answer;
  const relay = params.get("relay");
  if (relay) {
    // Impairment runs: point the browser at the harness's UDP relay instead of
    // the node's host candidate; the relay forwards to the real candidate.
    const [relayIp, relayPort] = relay.split(":");
    answer = answer.replace(
      /(a=candidate:\S+ \d+ udp \d+ )(\S+) (\d+)( typ host)/i,
      (_, head, ip, port, tail) => {
        window.relayTarget?.(ip, Number(port));
        return `${head}${relayIp} ${relayPort}${tail}`;
      },
    );
  }
  await pc.setRemoteDescription({ type: "answer", sdp: answer });
  if (jbt !== null) transceiver.receiver.jitterBufferTarget = Number(jbt);
  const track = await trackReady;
  await new Promise((resolve) =>
    track.muted
      ? track.addEventListener("unmute", resolve, { once: true })
      : resolve(),
  );
  results.connectMs = performance.now() - t0;
  results.outputLatency = context.outputLatency ?? null;
  setInterval(async () => {
    const report = await pc.getStats();
    for (const s of report.values()) {
      if (s.type === "inbound-rtp" && s.kind === "audio") {
        results.stats.push({
          at: performance.now(),
          jitterBufferDelay: s.jitterBufferDelay,
          jitterBufferEmittedCount: s.jitterBufferEmittedCount,
          jitterBufferTargetDelay: s.jitterBufferTargetDelay,
          jitterBufferMinimumDelay: s.jitterBufferMinimumDelay,
          concealedSamples: s.concealedSamples,
          totalSamplesReceived: s.totalSamplesReceived,
          packetsLost: s.packetsLost,
          packetsReceived: s.packetsReceived,
          jitter: s.jitter,
        });
      }
    }
  }, 1000);
  // Extra listeners for scaling runs: each is a full session, played muted.
  const extra = Number(params.get("extra") ?? 0);
  for (let i = 0; i < extra; i += 1) {
    const peer = new RTCPeerConnection({ bundlePolicy: "max-bundle" });
    peer.addTransceiver("audio", { direction: "recvonly" });
    peer.ontrack = (e) => {
      const sink = new Audio();
      sink.muted = true;
      sink.srcObject = new MediaStream([e.track]);
      void sink.play().catch(() => undefined);
    };
    await peer.setLocalDescription(await peer.createOffer());
    const r = await fetch("/audio/v0/listen/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: i % 2,
        offer: peer.localDescription.sdp,
      }),
    });
    if (!r.ok) {
      results.errors.push(`extra ${i}: HTTP ${r.status}`);
      break;
    }
    await peer.setRemoteDescription({
      type: "answer",
      sdp: (await r.json()).answer,
    });
  }
  results.extra = extra;
  out.textContent = `listening (${chain})`;
  results.ready = true;
}

/** Switches the node-side input and records when the request left. */
window.switchTo = async (channel) => {
  const sentWallMs = performance.timeOrigin + performance.now();
  const r = await fetch(`/audio/v0/listen/sessions/${session}/channel`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel }),
  });
  results.switches.push({
    channel,
    sentWallMs,
    status: r.status,
    ackWallMs: performance.timeOrigin + performance.now(),
  });
};
window.nowWallMs = () => performance.timeOrigin + performance.now();
main().catch((e) => {
  results.errors.push(String(e));
  out.textContent = String(e);
});
