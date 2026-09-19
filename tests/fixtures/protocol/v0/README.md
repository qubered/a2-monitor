# Protocol v0 golden fixtures

These fixtures are normative examples, not production credentials. Implementers
must parse, validate, RFC 8785-canonicalize and hash/sign the same logical values
identically. The placeholder signature is intentionally invalid; crypto tests
replace it from a deterministic test key and compare a checked-in vector before
the protocol is frozen.
