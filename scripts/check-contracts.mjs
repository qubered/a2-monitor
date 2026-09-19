import { spawnSync } from "node:child_process";
import process from "node:process";

const result = spawnSync(process.execPath, ["--test", "tests/contracts/*.test.mjs"], {
  cwd: process.cwd(),
  shell: true,
  stdio: "inherit"
});
process.exit(result.status ?? 1);
