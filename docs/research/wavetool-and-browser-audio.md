# WaveTool and browser-audio research

**Status:** Research snapshot

**Last reviewed:** 2026-09-18

This document records source-backed facts that informed the product plan. It
is not a substitute for validating behavior on the project's own hardware.

## Competitive baseline

Shure's current WAVETOOL 4 product page describes:

- up to 192 wired and wireless channels;
- real-time listening;
- synchronized global replay up to 30 minutes;
- intelligent microphone issue detection;
- up to eight concurrent clients; and
- chat with images, reactions, and voice notes.

Source: [Shure WAVETOOL 4](https://www.shure.com/en-US/products/software/wavetool4)

The resulting product lesson is that channel count and meters are table stakes.
The durable workflows are auditioning, history, issue detection, mic check,
scene/group context, and team handoff.

## Dante ingress constraints

Audinate publishes the following DVS capacities at 44.1/48 kHz:

- DVS: 64 x 64 channels;
- DVS Pro: 128 x 128 channels; and
- selectable 4, 6, or 10 ms latency buffers, with additional larger buffers
  available in DVS Pro.

Source: [Dante Virtual Soundcard comparison](https://www.getdante.com/products/software-essentials/dante-virtual-soundcard/compare/)

Audinate recommends ASIO for lower-latency professional Windows applications,
Core Audio on macOS, and a 4 ms Dante latency setting on capable systems, with
larger settings when scheduling is unstable.

Source: [DVS performance guidance](https://support.getdante.com/hc/en-gb/articles/5485084054303-How-do-I-get-the-best-performance-from-Dante-Virtual-Soundcard-and-my-audio-application)

Audinate's Dante Application Library can make a Windows/macOS application a
routable Dante device and currently advertises up to 64 x 64 channels. This is
a future commercial integration option rather than an assumed MVP dependency.

Source: [Dante Application Library](https://www.getdante.com/docs/dante-application-library-datasheet)

## Browser transport

The Opus RTP payload specification supports full-band audio frames of 2.5, 5,
10, and 20 ms. The RTP media-type default packetization time is 20 ms. Smaller
packet durations reduce packetization delay at the cost of more overhead.

Source: [RFC 7587](https://www.rfc-editor.org/info/rfc7587/)

WebRTC allows an application to express a desired receive jitter-buffer target,
but the browser may clamp it based on conditions. Actual delay should be read
from WebRTC statistics and verified physically.

Sources:

- [W3C WebRTC Recommendation](https://www.w3.org/TR/webrtc/)
- [MDN `jitterBufferTarget`](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpReceiver/jitterBufferTarget)

AudioWorklet supplies custom processing on the browser's audio rendering thread
and is a candidate for later experimental transports, not a reason to build a
custom jitter buffer before WebRTC has been measured.

Source: [MDN AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet)

Browser audio output selection requires a secure context and may require a user
permission gesture. Local HTTPS and first-run output selection are therefore
product requirements, not optional deployment polish.

Source: [MDN `HTMLMediaElement.setSinkId()`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/setSinkId)

## Sennheiser EW-DX

EW-DX firmware 4 and later supports Sennheiser Sound Control v2 through a
documented HTTPS API. The published API includes receiver identity, channel
warnings, RSSI, signal quality, diversity, audio level, transmitter data,
battery data, and subscription management.

Sources:

- [Sennheiser Sound Control Protocol](https://docs.cloud.sennheiser.com/en-us/api-docs/api-docs/sound-control-protocol.html)
- [EW-DX OpenAPI](https://docs.cloud.sennheiser.com/en-us/api-docs/api-docs/open-api-ew-dx.html)

Third-party access is disabled by default. Sennheiser recommends authenticated,
encrypted SSCv2; legacy SSCv1 is unsecured. The node should hold credentials
locally and expose only normalized state to the backend.

Source: [EW-DX third-party access](https://docs.cloud.sennheiser.com/en-us/tc-bar/control-cockpit/ew-dx-access.html)

Sennheiser distinguishes RF signal level from link quality because interference
can reduce quality without an equivalent fall in RSSI. Alert correlation must
therefore preserve both values rather than merging them into one health bar.

Source: [EW-DX receiver display and indicators](https://docs.cloud.sennheiser.com/en-us/ew-d/ew-d/reusable/ew-dx-em2-display-panel.html)

## Open validation questions

- What end-to-end latency is repeatable on each supported browser/output path?
- Which WebRTC packetization settings are honored by each browser?
- How does iPad behave during screen lock, app switching, and output changes?
- What EW-DX subscription frequency and reconnect semantics are observed across
  supported firmware versions?
- Can DVS Pro sustain 128-channel capture alongside replay and client mixes on
  the reference appliance without unsafe buffer sizes?
- What local certificate onboarding is acceptable to production crews?
