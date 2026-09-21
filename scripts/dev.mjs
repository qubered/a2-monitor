import { spawn } from "node:child_process";

const children = [
  spawn("npm", ["run", "dev", "--workspace", "@rvlt/pulse-backend"], {
    stdio: "inherit",
  }),
  spawn("npm", ["run", "dev", "--workspace", "@rvlt/pulse-listen-gateway"], {
    stdio: "inherit",
  }),
  spawn("npm", ["run", "dev", "--workspace", "@rvlt/pulse-live"], {
    stdio: "inherit",
  }),
];

let stopping = false;
function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stop(signal));
}

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (!stopping) {
      process.exitCode = code ?? (signal ? 1 : 0);
      stop();
    }
  });
  child.on("error", (error) => {
    console.error(error);
    process.exitCode = 1;
    stop();
  });
}
