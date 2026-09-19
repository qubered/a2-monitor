# Protocol v0 golden fixtures

These fixtures are normative examples, not production credentials. Implementers
must parse, validate, RFC 8785-canonicalize and hash/sign the same logical values
identically. Valid command signatures use the explicitly test-only P-256 JWK in
`tests/fixtures/evidence/test-keyring.json`; mutations and placeholder hashes are
rejected by executable contract tests.

The boot-authority-grant vector is likewise real; its test changes the boot ID
and proves the original signature no longer verifies.
