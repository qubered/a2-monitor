# Personal listening safety and field-kit contract

**Status:** Normative qualification baseline

Browser transport readiness is not proof of audibility. Every supported
headphone/output kit is a named tuple: client hardware, OS/browser, adapter,
headphones/earpiece, limiter/gain settings and intercom/radio arrangement.

The server mix maintains declared digital headroom and a true-peak limiter whose
ceiling, release and overload behavior are frozen in the profile. Final acoustic
exposure is measured on the exact kit and capped by the production's applicable
hearing-conservation policy; this plan does not invent a universal dBA value.
The profile records the responsible safety owner and measurement method.

Listen starts muted after page load, route change, device loss, decoder restart,
sleep/resume, reconnect or stale control state. It resumes only through an
explicit local action, ramps from silence over the qualified interval and never
restores a louder effective gain than the last locally confirmed value. A
latched listen/PFL cancels on route identity change, selected-source removal,
authority loss or interruption; stale key-up cannot reopen it.

A1 qualification exercises console PFL/solo alongside the app without obscuring
programme/cue communication. A2 qualification covers beltpack/intercom plus the
field device, one-ear/two-ear use, gloves, pocket/belt handling, cable snag,
screen lock and emergency radio access. The conventional intercom/radio remains
primary for urgent production communication.

Every client test records limiter activity, digital peak/true peak, reconnect
gain, route identity, cancellation response, acoustic measurement and operator
confirmation. Any unintended burst, wrong route, failure to cancel, obscured
intercom call or unsafe measured exposure is a zero-tolerance failure.
