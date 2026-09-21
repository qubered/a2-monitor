import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  stageApplicationSlot,
  verifyApplicationSlot,
} from "./stage-application-slot.mjs";

async function put(filename, content = filename) {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, content);
}

function executableFixture(platform, arch) {
  if (platform === "windows") {
    const bytes = Buffer.alloc(1024);
    bytes.write("MZ", 0, "ascii");
    bytes.writeUInt32LE(128, 0x3c);
    bytes.write("PE\0\0", 128, "binary");
    bytes.writeUInt16LE(arch === "x86_64" ? 0x8664 : 0xaa64, 132);
    bytes.writeUInt16LE(1, 134);
    bytes.writeUInt16LE(240, 148);
    bytes.writeUInt16LE(0x22, 150);
    bytes.writeUInt16LE(0x020b, 152);
    bytes.writeUInt32LE(0x1000, 168);
    bytes.writeUInt32LE(0x1000, 184);
    bytes.writeUInt32LE(0x200, 188);
    bytes.writeUInt32LE(0x2000, 208);
    bytes.writeUInt32LE(0x200, 212);
    bytes.writeUInt32LE(16, 260);
    bytes.write(".text\0\0\0", 392, "binary");
    bytes.writeUInt32LE(1, 400);
    bytes.writeUInt32LE(0x1000, 404);
    bytes.writeUInt32LE(0x200, 408);
    bytes.writeUInt32LE(0x200, 412);
    bytes.writeUInt32LE(0x60000020, 428);
    bytes[512] = 0xc3;
    return bytes;
  }
  const bytes = Buffer.alloc(105);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(arch === "aarch64" ? 0x0100000c : 0x01000007, 4);
  bytes.writeUInt32LE(2, 12);
  bytes.writeUInt32LE(1, 16);
  bytes.writeUInt32LE(72, 20);
  bytes.writeUInt32LE(0x19, 32);
  bytes.writeUInt32LE(72, 36);
  bytes.write("__TEXT", 40, "ascii");
  bytes.writeBigUInt64LE(105n, 64);
  bytes.writeBigUInt64LE(105n, 80);
  bytes.writeInt32LE(5, 88);
  bytes.writeInt32LE(5, 92);
  return bytes;
}

async function makeFixture(root) {
  const inputs = path.join(root, "inputs");
  await put(
    path.join(inputs, "a2-synthetic-capture"),
    executableFixture("macos", "aarch64"),
  );
  await put(
    path.join(inputs, "a2-supervisor-smoke"),
    executableFixture("macos", "aarch64"),
  );
  await put(path.join(inputs, "node"), executableFixture("macos", "aarch64"));
  await put(path.join(inputs, "NODE-LICENSE"), "Node.js licence fixture\n");
  await put(path.join(inputs, "Cargo.lock"), "cargo lock fixture\n");
  await put(path.join(inputs, "package-lock.json"), "{}\n");
  await put(path.join(inputs, "cargo-inventory.json"), "{}\n");
  await put(path.join(inputs, "node-inventory.json"), "{}\n");
  await put(
    path.join(inputs, "process-boundaries.v0.json"),
    await readFile(
      new URL("./process-boundaries.v0.json", import.meta.url),
      "utf8",
    ),
  );
  await put(
    path.join(inputs, "build-identity.json"),
    `${JSON.stringify({
      buildId: "a2-0.0.0+sha256.0123456789abcdef",
      version: "0.0.0",
      identityKind: "content-addressed-source-inputs",
      sourceSha256: "0".repeat(64),
    })}\n`,
  );
  await put(
    path.join(inputs, "release-metadata.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      buildProfile: "release",
      targetTriple: "aarch64-apple-darwin",
      protocolVersion: "v0",
      toolchains: {
        node: "24.21.0",
        npm: "11.6.2",
        rustc: "1.98.1",
        cargo: "1.98.1",
      },
    })}\n`,
  );
  await put(path.join(inputs, "backend", "start.js"), 'import "fastify";\n');
  await put(path.join(inputs, "backend", "server.js"), "export {};\n");
  await put(path.join(inputs, "backend", "server.d.ts"), "export {};\n");
  for (const dependency of ["fastify", "ajv", "ajv-formats"]) {
    await put(
      path.join(inputs, "node_modules", dependency, "package.json"),
      `${JSON.stringify({ name: dependency, version: "1.0.0" })}\n`,
    );
    await put(
      path.join(inputs, "node_modules", dependency, "index.js"),
      "export {};\n",
    );
  }
  await put(
    path.join(inputs, "protocol", "package.json"),
    `${JSON.stringify({ name: "@rvlt/pulse-protocol", type: "module" })}\n`,
  );
  await put(
    path.join(inputs, "protocol", "validation", "strict-ajv.mjs"),
    "export const createStrictAjv2020 = () => ({});\n",
  );
  await put(
    path.join(inputs, "protocol", "validation", "strict-ajv.d.mts"),
    "export function createStrictAjv2020(): object;\n",
  );
  await put(
    path.join(
      inputs,
      "protocol",
      "schema",
      "v0",
      "http",
      "health-response.schema.json",
    ),
    "{}\n",
  );
  await put(
    path.join(
      inputs,
      "protocol",
      "schema",
      "v0",
      "http",
      "live-snapshot-response.schema.json",
    ),
    "{}\n",
  );
  await put(
    path.join(inputs, "manager", "index.html"),
    "<main>manager</main>\n",
  );
  await put(path.join(inputs, "manager", "assets", "app.js"), "manager\n");
  await put(path.join(inputs, "live", "index.html"), "<main>live</main>\n");
  await put(path.join(inputs, "live", "assets", "app.css"), "live\n");
  return {
    "build-id": "a2-0.0.0+sha256.0123456789abcdef",
    platform: "macos",
    arch: "aarch64",
    "audio-node": path.join(inputs, "a2-synthetic-capture"),
    supervisor: path.join(inputs, "a2-supervisor-smoke"),
    "backend-dist": path.join(inputs, "backend"),
    "backend-dependencies": path.join(inputs, "node_modules"),
    "protocol-package": path.join(inputs, "protocol"),
    "manager-dist": path.join(inputs, "manager"),
    "live-dist": path.join(inputs, "live"),
    "node-runtime": path.join(inputs, "node"),
    "node-license": path.join(inputs, "NODE-LICENSE"),
    "build-identity": path.join(inputs, "build-identity.json"),
    "release-metadata": path.join(inputs, "release-metadata.json"),
    "cargo-lock": path.join(inputs, "Cargo.lock"),
    "npm-lock": path.join(inputs, "package-lock.json"),
    "cargo-inventory": path.join(inputs, "cargo-inventory.json"),
    "node-inventory": path.join(inputs, "node-inventory.json"),
    "process-contract": path.join(inputs, "process-boundaries.v0.json"),
  };
}

async function makeRemovable(filename) {
  const metadata = await lstat(filename).catch(() => null);
  if (!metadata || metadata.isSymbolicLink()) return;
  if (metadata.isDirectory()) {
    await chmod(filename, 0o755).catch(() => {});
    const { readdir } = await import("node:fs/promises");
    for (const entry of await readdir(filename))
      await makeRemovable(path.join(filename, entry));
  } else {
    await chmod(filename, 0o644).catch(() => {});
  }
}

async function withFixture(run) {
  const root = await mkdtemp(path.join(tmpdir(), "a2-slot-test-"));
  try {
    await run(root, await makeFixture(root));
  } finally {
    await makeRemovable(root);
    await rm(root, { recursive: true, force: true });
  }
}

test("stages and verifies a deterministic closed application slot", async () => {
  await withFixture(async (root, options) => {
    const first = await stageApplicationSlot({
      ...options,
      "output-root": path.join(root, "out-a"),
    });
    const second = await stageApplicationSlot({
      ...options,
      "output-root": path.join(root, "out-b"),
    });
    const firstManifestBytes = await readFile(
      path.join(first, "slot-manifest.json"),
      "utf8",
    );
    const secondManifestBytes = await readFile(
      path.join(second, "slot-manifest.json"),
      "utf8",
    );
    assert.equal(firstManifestBytes, secondManifestBytes);

    const manifest = await verifyApplicationSlot(first);
    assert.equal(manifest.buildId, options["build-id"]);
    assert.equal(manifest.platform, "macos");
    assert.equal(manifest.arch, "aarch64");
    assert.equal(manifest.artifactKind, "unsigned-smoke-slot");
    assert.equal(manifest.targetTriple, "aarch64-apple-darwin");
    assert.equal(manifest.toolchains.node, "24.21.0");
    assert.match(manifest.lockSha256.cargo, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      manifest.files.map((entry) => entry.path),
      [...manifest.files.map((entry) => entry.path)].sort((left, right) =>
        Buffer.compare(Buffer.from(left), Buffer.from(right)),
      ),
    );
    assert.ok(
      manifest.files.some((entry) => entry.path === "backend/package.json"),
    );
    assert.ok(
      manifest.files.some(
        (entry) =>
          entry.path === "licenses/node/LICENSE" && entry.role === "license",
      ),
    );
    assert.ok(
      manifest.files.some(
        (entry) =>
          entry.path === "config/process-boundaries.v0.json" &&
          entry.role === "process_contract",
      ),
    );
    assert.ok(
      manifest.files.some(
        (entry) =>
          entry.path ===
            "backend/node_modules/@rvlt/pulse-protocol/validation/strict-ajv.mjs" &&
          entry.role === "protocol_runtime",
      ),
    );
    assert.ok(
      manifest.files.some(
        (entry) =>
          entry.path ===
            "backend/node_modules/@rvlt/pulse-protocol/schema/v0/http/health-response.schema.json" &&
          entry.role === "protocol_schema",
      ),
    );
    if (process.platform !== "win32") {
      assert.equal((await stat(first)).mode & 0o777, 0o555);
      assert.equal(
        (await stat(path.join(first, "bin", "a2-synthetic-capture"))).mode &
          0o777,
        0o555,
      );
      assert.equal(
        (await stat(path.join(first, "web", "live", "index.html"))).mode &
          0o777,
        0o444,
      );
    }
    assert.equal(
      (await stat(path.join(first, "web", "live", "index.html"))).mtimeMs,
      946684800000,
    );
  });
});

test("uses fixed Windows executable names", async () => {
  await withFixture(async (root, options) => {
    await Promise.all([
      writeFile(options["audio-node"], executableFixture("windows", "x86_64")),
      writeFile(options.supervisor, executableFixture("windows", "x86_64")),
      writeFile(
        options["node-runtime"],
        executableFixture("windows", "x86_64"),
      ),
    ]);
    const windowsMetadata = path.join(
      root,
      "inputs",
      "windows-release-metadata.json",
    );
    await put(
      windowsMetadata,
      `${JSON.stringify({
        schemaVersion: 1,
        buildProfile: "release",
        targetTriple: "x86_64-pc-windows-msvc",
        protocolVersion: "v0",
        toolchains: {
          node: "24.21.0",
          npm: "11.6.2",
          rustc: "1.98.1",
          cargo: "1.98.1",
        },
      })}\n`,
    );
    const slot = await stageApplicationSlot({
      ...options,
      "output-root": path.join(root, "out"),
      platform: "windows",
      arch: "x86_64",
      "release-metadata": windowsMetadata,
    });
    await lstat(path.join(slot, "bin", "a2-synthetic-capture.exe"));
    await lstat(path.join(slot, "bin", "a2-supervisor-smoke.exe"));
    await lstat(path.join(slot, "runtime", "node.exe"));
  });
});

test("rejects executables for a different platform or architecture", async () => {
  await withFixture(async (root, options) => {
    await writeFile(options.supervisor, executableFixture("macos", "x86_64"));
    await assert.rejects(
      stageApplicationSlot({
        ...options,
        "output-root": path.join(root, "wrong-arch-out"),
      }),
      /not a Mach-O executable for aarch64/,
    );
  });

  await withFixture(async (root, options) => {
    await writeFile(
      options["audio-node"],
      Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0, 0, 1]),
    );
    await assert.rejects(
      stageApplicationSlot({
        ...options,
        "output-root": path.join(root, "truncated-out"),
      }),
      /not a Mach-O executable for aarch64/,
    );
  });

  await withFixture(async (root, options) => {
    const windowsMetadata = path.join(
      root,
      "inputs",
      "windows-release-metadata.json",
    );
    await put(
      windowsMetadata,
      `${JSON.stringify({
        schemaVersion: 1,
        buildProfile: "release",
        targetTriple: "x86_64-pc-windows-msvc",
        protocolVersion: "v0",
        toolchains: {
          node: "24.21.0",
          npm: "11.6.2",
          rustc: "1.98.1",
          cargo: "1.98.1",
        },
      })}\n`,
    );
    await assert.rejects(
      stageApplicationSlot({
        ...options,
        platform: "windows",
        arch: "x86_64",
        "release-metadata": windowsMetadata,
        "output-root": path.join(root, "wrong-platform-out"),
      }),
      /not a PE executable/,
    );
  });

  await withFixture(async (root, options) => {
    const truncatedPe = Buffer.alloc(70);
    truncatedPe.write("MZ", 0, "ascii");
    truncatedPe.writeUInt32LE(64, 0x3c);
    truncatedPe.write("PE\0\0", 64, "binary");
    truncatedPe.writeUInt16LE(0x8664, 68);
    await writeFile(options["audio-node"], truncatedPe);
    const windowsMetadata = path.join(
      root,
      "inputs",
      "windows-release-metadata.json",
    );
    await put(
      windowsMetadata,
      `${JSON.stringify({
        schemaVersion: 1,
        buildProfile: "release",
        targetTriple: "x86_64-pc-windows-msvc",
        protocolVersion: "v0",
        toolchains: {
          node: "24.21.0",
          npm: "11.6.2",
          rustc: "1.98.1",
          cargo: "1.98.1",
        },
      })}\n`,
    );
    await writeFile(options.supervisor, executableFixture("windows", "x86_64"));
    await writeFile(
      options["node-runtime"],
      executableFixture("windows", "x86_64"),
    );
    await assert.rejects(
      stageApplicationSlot({
        ...options,
        platform: "windows",
        arch: "x86_64",
        "release-metadata": windowsMetadata,
        "output-root": path.join(root, "truncated-pe-out"),
      }),
      /truncated executable header|not a complete executable PE image/,
    );
  });
});

test("refuses to overwrite an immutable version slot", async () => {
  await withFixture(async (root, options) => {
    const staged = { ...options, "output-root": path.join(root, "out") };
    await stageApplicationSlot(staged);
    await assert.rejects(
      stageApplicationSlot(staged),
      /will not be overwritten/,
    );
  });
});

test("rejects symlinks and secret-like or unexpected input files", async () => {
  await withFixture(async (root, options) => {
    await symlink(
      path.join(options["manager-dist"], "index.html"),
      path.join(options["manager-dist"], "linked.html"),
    );
    await assert.rejects(
      stageApplicationSlot({
        ...options,
        "output-root": path.join(root, "symlink-out"),
      }),
      /symbolic link/,
    );
    await rm(path.join(options["manager-dist"], "linked.html"));

    await put(
      path.join(options["backend-dependencies"], ".env.production"),
      "SECRET=yes\n",
    );
    await assert.rejects(
      stageApplicationSlot({
        ...options,
        "output-root": path.join(root, "secret-out"),
      }),
      /secret-like path/,
    );
    await rm(path.join(options["backend-dependencies"], ".env.production"));

    await put(
      path.join(options["live-dist"], "unexpected.exe"),
      "not an asset",
    );
    await assert.rejects(
      stageApplicationSlot({
        ...options,
        "output-root": path.join(root, "unexpected-out"),
      }),
      /unexpected file type/,
    );
  });
});

test("rejects non-portable normalized and reserved paths", async () => {
  for (const filename of ["CON.js", "trailing.js ", "e\u0301.js"]) {
    await withFixture(async (root, options) => {
      await put(path.join(options["backend-dist"], filename), "export {};\n");
      await assert.rejects(
        stageApplicationSlot({
          ...options,
          "output-root": path.join(root, "bad-path-out"),
        }),
        /unsafe path segment/,
      );
    });
  }
});

test("rejects missing production dependencies and a bundled protocol workspace link", async () => {
  await withFixture(async (root, options) => {
    await rm(path.join(options["backend-dependencies"], "fastify"), {
      recursive: true,
    });
    await assert.rejects(
      stageApplicationSlot({
        ...options,
        "output-root": path.join(root, "missing-out"),
      }),
      /missing required file: fastify\/package.json/,
    );
  });

  await withFixture(async (root, options) => {
    await mkdir(path.join(options["backend-dependencies"], "@rvlt"));
    await symlink(
      options["protocol-package"],
      path.join(options["backend-dependencies"], "@rvlt", "pulse-protocol"),
    );
    await assert.rejects(
      stageApplicationSlot({
        ...options,
        "output-root": path.join(root, "linked-protocol-out"),
      }),
      /symbolic link/,
    );
  });
});

test("verification rejects tampering, extra files, traversal, and unknown manifest fields", async () => {
  if (process.platform !== "win32") {
    await withFixture(async (root, options) => {
      const slot = await stageApplicationSlot({
        ...options,
        "output-root": path.join(root, "out"),
      });
      await chmod(path.join(slot, "bin", "a2-synthetic-capture"), 0o444);
      await assert.rejects(verifyApplicationSlot(slot), /mode mismatch/);
    });
  }

  await withFixture(async (root, options) => {
    const slot = await stageApplicationSlot({
      ...options,
      "output-root": path.join(root, "out"),
    });
    const missingPath = "bin/a2-synthetic-capture";
    const manifestPath = path.join(slot, "slot-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.files = manifest.files.filter(
      (entry) => entry.path !== missingPath,
    );
    await chmod(slot, 0o755);
    await chmod(path.join(slot, "bin"), 0o755);
    await rm(path.join(slot, missingPath));
    await chmod(manifestPath, 0o644);
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
    await assert.rejects(
      verifyApplicationSlot(slot),
      /missing required payload file/,
    );
  });

  await withFixture(async (root, options) => {
    const slot = await stageApplicationSlot({
      ...options,
      "output-root": path.join(root, "out"),
    });
    await chmod(path.join(slot, "web", "live"), 0o755);
    await chmod(path.join(slot, "web", "live", "index.html"), 0o644);
    await writeFile(path.join(slot, "web", "live", "index.html"), "tampered\n");
    await assert.rejects(
      verifyApplicationSlot(slot),
      /size mismatch|SHA-256 mismatch/,
    );
  });

  await withFixture(async (root, options) => {
    const slot = await stageApplicationSlot({
      ...options,
      "output-root": path.join(root, "out"),
    });
    await chmod(slot, 0o755);
    await put(path.join(slot, "extra.txt"), "extra\n");
    await assert.rejects(verifyApplicationSlot(slot), /exactly match/);
  });

  for (const mutate of [
    (manifest) => {
      manifest.files[0].path = "../escape";
    },
    (manifest) => {
      manifest.unknown = true;
    },
  ]) {
    await withFixture(async (root, options) => {
      const slot = await stageApplicationSlot({
        ...options,
        "output-root": path.join(root, "out"),
      });
      const manifestPath = path.join(slot, "slot-manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      mutate(manifest);
      await chmod(slot, 0o755);
      await chmod(manifestPath, 0o644);
      await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
      await assert.rejects(
        verifyApplicationSlot(slot),
        /unsafe path|missing or unknown properties/,
      );
    });
  }

  await withFixture(async (root, options) => {
    const slot = await stageApplicationSlot({
      ...options,
      "output-root": path.join(root, "out"),
    });
    const manifestPath = path.join(slot, "slot-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const dependency = manifest.files.find(
      (entry) => entry.path === "backend/node_modules/fastify/index.js",
    );
    dependency.role = "manager_asset";
    await chmod(slot, 0o755);
    await chmod(manifestPath, 0o644);
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
    await assert.rejects(verifyApplicationSlot(slot), /path has invalid role/);
  });
});

test("verification rejects a self-consistent but invalid process contract", async () => {
  await withFixture(async (root, options) => {
    const slot = await stageApplicationSlot({
      ...options,
      "output-root": path.join(root, "out"),
    });
    const contractPath = path.join(
      slot,
      "config",
      "process-boundaries.v0.json",
    );
    const manifestPath = path.join(slot, "slot-manifest.json");
    await chmod(contractPath, 0o644);
    await chmod(manifestPath, 0o644);
    const contract = JSON.parse(await readFile(contractPath, "utf8"));
    contract.boundaries[0].current.privilegeVerified = true;
    const contractBytes = `${JSON.stringify(contract, null, 2)}\n`;
    await writeFile(contractPath, contractBytes);

    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const entry = manifest.files.find(
      (candidate) => candidate.path === "config/process-boundaries.v0.json",
    );
    entry.size = Buffer.byteLength(contractBytes);
    entry.sha256 = createHash("sha256").update(contractBytes).digest("hex");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await chmod(contractPath, 0o444);
    await chmod(manifestPath, 0o444);

    await assert.rejects(
      verifyApplicationSlot(slot),
      /privilegeVerified must remain false/,
    );
  });
});
