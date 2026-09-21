import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  createHttpContractClient,
  parseHealthResponse,
  parseLiveSnapshot,
  parseShowfile,
  ProtocolContractError,
  ProtocolHttpError,
} from "../generated/http-contracts";
import { createStrictAjv2020 } from "../validation/strict-ajv.mjs";
import healthResponseSchema from "../schema/v0/http/health-response.schema.json";
import liveSnapshotResponseSchema from "../schema/v0/http/live-snapshot-response.schema.json";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function fixture(relativePath: string): Promise<unknown> {
  return JSON.parse(
    await readFile(
      path.join(packageRoot, "fixtures/v0/http", relativePath),
      "utf8",
    ),
  );
}

describe("generated HTTP contract compatibility", () => {
  for (const release of ["current", "previous"]) {
    it(`accepts the ${release} health response`, async () => {
      const value = await fixture(`${release}/health-response.valid.json`);
      expect(parseHealthResponse(value)).toEqual(value);
    });

    it(`accepts the ${release} Live snapshot response`, async () => {
      const value = await fixture(
        `${release}/live-snapshot-response.valid.json`,
      );
      expect(parseLiveSnapshot(value)).toEqual(value);
    });
  }

  it("rejects an unknown health field", async () => {
    const value = await fixture(
      "incompatible/health-response.unknown-field.json",
    );
    expect(() => parseHealthResponse(value)).toThrow(ProtocolContractError);
  });

  it("rejects an unknown nested snapshot field", async () => {
    const value = await fixture(
      "incompatible/live-snapshot-response.unknown-field.json",
    );
    expect(() => parseLiveSnapshot(value)).toThrow(ProtocolContractError);
  });

  it("rejects an incompatible snapshot major", async () => {
    const value = await fixture(
      "incompatible/live-snapshot-response.major-version.json",
    );
    expect(() => parseLiveSnapshot(value)).toThrow(ProtocolContractError);
  });

  it("accepts a showfile and rejects unknown fields", async () => {
    const value = await fixture("current/showfile.valid.json");
    const invalid = await fixture("incompatible/showfile.unknown-field.json");
    expect(parseShowfile(value)).toEqual(value);
    expect(() => parseShowfile(invalid)).toThrow(ProtocolContractError);
  });

  it("rejects a normalized but impossible calendar date", async () => {
    const parity = (await fixture("parity-values.json")) as {
      invalidCalendarDateTime: string;
    };
    const value = (await fixture(
      "current/live-snapshot-response.valid.json",
    )) as Record<string, unknown>;
    expect(() =>
      parseLiveSnapshot({
        ...value,
        generatedAtUtc: parity.invalidCalendarDateTime,
      }),
    ).toThrow(ProtocolContractError);
  });

  it("counts string lengths as Unicode code points", async () => {
    const parity = (await fixture("parity-values.json")) as {
      validUnicodeAtAlertLabelBoundary: string;
    };
    const value = (await fixture(
      "current/live-snapshot-response.valid.json",
    )) as { channels: Array<Record<string, unknown>> };
    const first = value.channels[0];
    const alert = first.alert as Record<string, unknown>;

    expect(
      parseLiveSnapshot({
        ...value,
        channels: [
          {
            ...first,
            alert: {
              ...alert,
              label: parity.validUnicodeAtAlertLabelBoundary,
            },
          },
        ],
      }),
    ).toBeTruthy();
  });

  it("accepts link-quality boundaries and rejects values outside them", async () => {
    const parity = (await fixture("parity-values.json")) as {
      validLinkQualityPercent: number[];
      invalidLinkQualityPercent: number[];
    };
    const value = (await fixture(
      "current/live-snapshot-response.valid.json",
    )) as { channels: Array<Record<string, unknown>> };
    const first = value.channels[0];
    const details = first.details as Record<string, unknown>;
    const withLinkQuality = (linkQualityPercent: number) => ({
      ...value,
      channels: [{ ...first, details: { ...details, linkQualityPercent } }],
    });

    for (const boundary of parity.validLinkQualityPercent) {
      expect(parseLiveSnapshot(withLinkQuality(boundary))).toBeTruthy();
    }
    for (const invalid of parity.invalidLinkQualityPercent) {
      expect(() => parseLiveSnapshot(withLinkQuality(invalid))).toThrow(
        ProtocolContractError,
      );
    }
  });
});

describe("shared Ajv contract compatibility", () => {
  const cases = [
    {
      schema: healthResponseSchema,
      accepted: [
        "current/health-response.valid.json",
        "previous/health-response.valid.json",
      ],
      rejected: ["incompatible/health-response.unknown-field.json"],
    },
    {
      schema: liveSnapshotResponseSchema,
      accepted: [
        "current/live-snapshot-response.valid.json",
        "previous/live-snapshot-response.valid.json",
      ],
      rejected: [
        "incompatible/live-snapshot-response.major-version.json",
        "incompatible/live-snapshot-response.unknown-field.json",
      ],
    },
  ];

  for (const [index, contract] of cases.entries()) {
    it(`validates accepted and rejected fixture set ${index + 1} without mutation`, async () => {
      const validate = createStrictAjv2020().compile(contract.schema);

      for (const fixturePath of contract.accepted) {
        const value = await fixture(fixturePath);
        const before = structuredClone(value);
        expect(validate(value), fixturePath).toBe(true);
        expect(value).toEqual(before);
      }
      for (const fixturePath of contract.rejected) {
        const value = await fixture(fixturePath);
        const before = structuredClone(value);
        expect(validate(value), fixturePath).toBe(false);
        expect(value).toEqual(before);
      }
    });
  }

  it("matches the committed calendar, Unicode, and link-quality parity vectors", async () => {
    const validate = createStrictAjv2020().compile(liveSnapshotResponseSchema);
    const parity = (await fixture("parity-values.json")) as {
      invalidCalendarDateTime: string;
      validUnicodeAtAlertLabelBoundary: string;
      validLinkQualityPercent: number[];
      invalidLinkQualityPercent: number[];
    };
    const snapshot = (await fixture(
      "current/live-snapshot-response.valid.json",
    )) as { generatedAtUtc: string; channels: Array<Record<string, unknown>> };
    const firstChannel = snapshot.channels[0];
    const alert = firstChannel.alert as Record<string, unknown>;
    const details = firstChannel.details as Record<string, unknown>;
    const cases = [
      {
        value: {
          ...snapshot,
          generatedAtUtc: parity.invalidCalendarDateTime,
        },
        accepted: false,
      },
      {
        value: {
          ...snapshot,
          channels: [
            {
              ...firstChannel,
              alert: {
                ...alert,
                label: parity.validUnicodeAtAlertLabelBoundary,
              },
            },
          ],
        },
        accepted: true,
      },
      ...parity.validLinkQualityPercent.map((linkQualityPercent) => ({
        value: {
          ...snapshot,
          channels: [
            {
              ...firstChannel,
              details: { ...details, linkQualityPercent },
            },
          ],
        },
        accepted: true,
      })),
      ...parity.invalidLinkQualityPercent.map((linkQualityPercent) => ({
        value: {
          ...snapshot,
          channels: [
            {
              ...firstChannel,
              details: { ...details, linkQualityPercent },
            },
          ],
        },
        accepted: false,
      })),
    ];

    for (const parityCase of cases) {
      const before = structuredClone(parityCase.value);
      expect(validate(parityCase.value)).toBe(parityCase.accepted);
      expect(parityCase.value).toEqual(before);
    }
  });
});

describe("generated HTTP client", () => {
  it("uses the declared route and validates before returning", async () => {
    const value = await fixture("current/live-snapshot-response.valid.json");
    const fetchResponse = vi.fn(async () => Response.json(value));
    const client = createHttpContractClient(fetchResponse);

    await expect(client.getLiveSnapshot()).resolves.toEqual(value);
    expect(fetchResponse).toHaveBeenCalledWith("/api/v1/live/snapshot", {
      signal: undefined,
    });
  });

  it("reports a typed non-success response", async () => {
    const client = createHttpContractClient(async () =>
      Response.json({}, { status: 503 }),
    );

    await expect(client.getHealth()).rejects.toBeInstanceOf(ProtocolHttpError);
  });

  it("rejects a response by declared length before reading its body", async () => {
    const fetchResponse = vi.fn(async () =>
      Response.json(
        { status: "ok", service: "a2-backend", version: "0.0.0" },
        { headers: { "content-length": "4097" } },
      ),
    );
    const client = createHttpContractClient(fetchResponse);

    await expect(client.getHealth()).rejects.toBeInstanceOf(
      ProtocolContractError,
    );
  });

  it("stops streaming after the response byte cap", async () => {
    const oversized = new Uint8Array(1_048_577).fill(32);
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(oversized);
          controller.close();
        },
      }),
    );
    const client = createHttpContractClient(async () => response);

    await expect(client.getLiveSnapshot()).rejects.toBeInstanceOf(
      ProtocolContractError,
    );
  });
});
