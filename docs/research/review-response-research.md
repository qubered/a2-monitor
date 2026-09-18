# Research supporting the independent-review response

**Status:** Research snapshot

**Last reviewed:** 2026-09-18

## Cue authority and QLab

QLab 5 can broadcast performance events over OSC or MIDI Show Control. Its OSC
show-control broadcast reports GO, cue start/stop and playhead movement with cue
number, name, unique ID and type. A client explicitly subscribes with `/listen`.
QLab also distinguishes a GO from a cue that starts for another reason, and
reports audition/preview activity. UDP listeners require keepalive behavior.

Sources:

- [QLab 5 show-control broadcast](https://qlab.app/docs/v5/networking/show-control-broadcast/)
- [QLab 5 OSC dictionary](https://qlab.app/docs/v5/scripting/osc-dictionary-v5/)

Product consequence: QLab is a viable first **read-only cue observer**, but its
playhead is the next/standby position rather than proof that a show moment has
occurred. Audition, start, GO, panic/reset and playhead events must remain
distinct. Each production must map external stable cue IDs to operational cue
definitions explicitly; the product cannot infer performer state from every
sound-effect cue. No command is sent back to QLab in the first integration.

## Foreground browser operation

The Screen Wake Lock API can prevent a visible document from dimming or locking,
but only while the document remains active; the lock is automatically released
when the document becomes inactive and must be reacquired on visibility change.
Apple Guided Access can restrict an iPad to one application, which is useful for
a dedicated show device but does not turn browser background execution into a
guarantee.

Sources:

- [MDN Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)
- [Apple: Use Guided Access on iPhone or iPad](https://support.apple.com/en-ie/111795)
- [MDN Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)

Product consequence: version one supports a dedicated, screen-awake foreground
device. Intercom/radio remains the urgent path. Wake lock and Guided Access are
useful safeguards, not background-delivery promises. Locked/background
monitoring or paging as a core requirement triggers native-client evaluation.

## Browser audio output and voice capture

Browser output selection is not universally available. `AudioContext.setSinkId`
is explicitly marked limited availability, requires a secure context and may
require media-device permission. Acquiring a microphone also invokes browser
and OS permission/audio-session behavior that varies by supported profile.

Sources:

- [MDN AudioContext.setSinkId](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/setSinkId)
- [MDN Audio Output Devices API](https://developer.mozilla.org/en-US/docs/Web/API/Audio_Output_Devices_API)

Product consequence: a notification sound or voice-note recorder cannot be
assumed safe merely because it works in one browser. Both are profile-gated.
Visual paging is the baseline; notification audio uses the application's one
controlled audio graph only when its sink and level are verified. Voice notes
are disabled on profiles where microphone acquisition changes route, latency,
gain, echo processing or monitoring continuity.

## Physical wireless changes

Current receiver workflows still require explicit hardware association. For
example, Shure documents IR Sync as the action that forms an Axient Digital
audio channel and uses IR synchronization in ULX-D setup/security workflows.
Updating an assignment database therefore cannot prove that a transmitter and
receiver are paired, encrypted or physically installed.

Sources:

- [Shure Axient Digital AD4D user guide](https://pubs.shure.com/view/guide/AD4D/en-US.pdf)
- [Shure ULX-D user guide](https://pubs.shure.com/guide/ULXD)

Product consequence: show-time transactions distinguish intended identity,
physical installation, observed receiver association, captured audio and A1
confirmation. A fully prepared spare can take a fast path, but the product does
not claim to have completed an external hardware, Dante or console action.

## Real-time resource isolation

Windows provides MMCSS task classes, including a high-priority Pro Audio class,
to give time-sensitive multimedia threads prioritized CPU access. Apple Audio
Workgroups coordinate auxiliary real-time work with the audio I/O thread. These
facilities help scheduling but do not replace bounded work, memory/disk quotas,
admission control or overload testing.

Sources:

- [Microsoft Multimedia Class Scheduler Service](https://learn.microsoft.com/en-us/windows/win32/procthread/multimedia-class-scheduler-service)
- [Apple: Understanding Audio Workgroups](https://developer.apple.com/documentation/audiotoolbox/understanding-audio-workgroups)

Product consequence: the audio callback remains bounded and preallocated;
capture and live media receive reserved resources. Chat, upload decoding and
transcription are lower-priority, separately limited workers that shed work
before audio is affected. Co-location is supported only after combined-load
proof; otherwise rich collaboration moves to another host or is disabled while
a performance is active.

## Collaboration authorization and uploads

OWASP identifies object-level authorization as a per-object server check, not a
property of unpredictable IDs or possession of a broad endpoint scope. Its file
upload guidance recommends allowlisted types, size limits, authorization,
storage outside the web root/separate storage, least privilege and validation
before further processing.

Sources:

- [OWASP API1: Broken Object Level Authorization](https://api-security.owasp.org/editions/2023/en/0xa1-broken-object-level-authorization/)
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)

Product consequence: every performance, conversation, incident, message and
attachment access uses object-level policy. Context links never grant access.
Attachments have quarantine/processing/ready/rejected states, fixed quotas,
safe renditions and short-lived authorized delivery; a message can reference
only a ready asset.

## Candidate experiments from brainstorming

These are useful experiments, not committed release promises:

- **Cue shadow mode:** observe and compare external cues with a manual rehearsal
  log without driving views/alerts, then show missed/duplicate/misaligned events
  before an adapter is allowed to become authority.
- **Operational cue mapping wizard:** record QLab GO events during a rehearsal
  and let the sound team map only meaningful entrances, exits, intervals and
  change windows instead of importing every playback cue.
- **Prepared-spare passport:** show exactly which element/fit/RF/audio/mute/
  battery checks remain reusable and which expire when a component, person,
  costume, zone or time window changes.
- **Scan-assisted physical truth:** optional QR/barcode/NFC confirmation for
  high-value packs and kits, always with a manual path and never treated as RF/
  audio proof by itself.
- **Physical-change timer:** one large A2 action starts the change, exposes the
  deadline and ordered checks, and lets A1 see “hands on performer” without
  opening chat.
- **Show-mode client preflight:** a short readiness screen verifies foreground,
  wake lock, output, safe level, battery/power, Wi-Fi, permissions and intercom
  fallback before admitting the client as show-ready.
- **Resource shadow load:** before enabling rich collaboration on a co-located
  appliance, replay recorded message/upload/page load against a rehearsal while
  the feature remains unavailable to operators.
