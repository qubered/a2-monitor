import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";
import { canonicalize, parseStrictJson } from "./strict-json.mjs";

const fixtureUrl = new URL(
  "fixtures/openssl-es256-jcs-v1.json",
  import.meta.url,
);

test("verifies the fixed OpenSSL ES256/JCS conformance vector", async () => {
  const fixture = parseStrictJson(await readFile(fixtureUrl));
  assert.equal(fixture.kind, "a2-evidence-es256-jcs-conformance-vector");
  assert.equal(fixture.promotionEligible, false);
  assert.equal(fixture.payload.promotionEligible, false);

  const actualCanonicalJson = canonicalize(fixture.payload);
  assert.equal(actualCanonicalJson, fixture.expectedCanonicalJson);
  const expectedCanonicalBytes = Buffer.from(
    fixture.expectedCanonicalUtf8Hex,
    "hex",
  );
  const actualCanonicalBytes = Buffer.from(actualCanonicalJson, "utf8");
  assert.deepEqual(actualCanonicalBytes, expectedCanonicalBytes);
  assert.equal(
    createHash("sha256").update(actualCanonicalBytes).digest("hex"),
    fixture.expectedCanonicalSha256,
  );

  const publicKey = createPublicKey(fixture.publicKeySpkiPem);
  assert.equal(publicKey.asymmetricKeyType, "ec");
  assert.equal(publicKey.asymmetricKeyDetails.namedCurve, "prime256v1");
  assert.equal(
    createHash("sha256")
      .update(publicKey.export({ type: "spki", format: "der" }))
      .digest("hex"),
    fixture.provenance.publicKeySpkiSha256,
  );

  const derSignature = Buffer.from(fixture.signatureDerHex, "hex");
  assert.equal(
    verify("sha256", actualCanonicalBytes, publicKey, derSignature),
    true,
  );

  const p1363Signature = Buffer.from(fixture.signatureP1363Hex, "hex");
  assert.equal(p1363Signature.byteLength, 64);
  assert.equal(
    verify(
      "sha256",
      actualCanonicalBytes,
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      p1363Signature,
    ),
    true,
  );

  const changedCanonical = Buffer.from(actualCanonicalBytes);
  changedCanonical[changedCanonical.byteLength - 1] ^= 1;
  assert.equal(
    verify(
      "sha256",
      changedCanonical,
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      p1363Signature,
    ),
    false,
  );
});
