# Client, browser, and appliance qualification profiles

**Status:** Normative planning baseline

## Browser lifecycle

The client states are `preflight`, `transport-ready`, `suspect`, `interrupted`,
`recovering`, `resyncing` and `transport-ready-restored`. Server-observed
heartbeat plus advancing RTP/media statistics can retain `transport-ready`; they
cannot prove audible rendering, physical sink, system gain or worn headphones.
A hidden or suspended page cannot certify itself. On return, the server supplies the last
healthy timestamp and the UI reconstructs and displays the blind interval before
resync. Listen control is blocked until route identity, gain, media sequence and
state snapshot agree. The operator must confirm the qualified output route and
audibility at preflight and after every route/reconnect interruption; only that
local confirmation may label the workstation `listen-confirmed`.

The compatibility owner is the release lead. Supported profiles pin OS major/
minor, browser family and tested minimum/maximum build, MDM/single-app posture,
output adapter and network class. Browser updates enter a canary device first
and are requalified within five business days; an unqualified auto-update blocks
show-ready unless the release lead selects a documented previous-browser/native
fallback. Feature probes run at every preflight but never replace the named
compatibility matrix.

## Initial appliance CPU profile

Phase 0 qualifies Windows 11 x86-64 and Apple-silicon macOS first, each on an
exact in-support OS build. macOS x86-64 and Windows ARM64 remain portable build
targets, not support claims, until their own audio-device and installer HIL
profiles pass. Windows ARM64 cannot be a DVS profile while Audinate does not
support DVS on that architecture; this does not prevent a separately qualified
USB-device profile later.

## Appliance resource order

The enforced order is:

1. capture/device clock;
2. canonical control ledger and existing bounded node control;
3. existing live media;
4. replay writer;
5. essential state import/reconciliation;
6. admitted replay readers;
7. text collaboration/paging;
8. assets, export, indexing and optional rich processing.

Each Windows and macOS profile declares CPU set/priority facility, callback and
worker threads, resident/commit memory, page-cache assumption, process/handle/
socket limits, network queues, disk bytes, write IOPS, read IOPS and p99 fsync/
read latency. Windows reports MMCSS and DPC/ISR latency; macOS reports Audio
Workgroup/QoS and memory-pressure behavior. Admission uses measured headroom,
not CPU percentage alone.

Replay writer and canonical ledger reservations are independent. A replay read
cannot consume either reservation. If the OS cannot provide adequate isolation,
the qualified profile moves backend/assets to another host or disables lower-
priority features during a performance.
