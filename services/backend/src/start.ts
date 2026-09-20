import { buildServer } from "./server.js";

const host = "127.0.0.1";
const port = 3000;
const server = buildServer({ logger: true });

try {
  await server.listen({ host, port });
} catch (error) {
  server.log.error(error);
  process.exitCode = 1;
}
