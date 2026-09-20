import type { FastifyInstance } from "fastify";

const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

export type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number];

export type SignalTarget = {
  on(signal: ShutdownSignal, listener: () => void): unknown;
  off(signal: ShutdownSignal, listener: () => void): unknown;
};

export type BackendProcessOptions = {
  server: Pick<FastifyInstance, "close" | "listen">;
  host: string;
  port: number;
  signalTarget?: SignalTarget;
  onShutdownError?: (error: unknown) => void;
};

export type BackendProcess = {
  shutdown(): Promise<void>;
};

export async function startBackendProcess({
  server,
  host,
  port,
  signalTarget = process,
  onShutdownError = () => {},
}: BackendProcessOptions): Promise<BackendProcess> {
  let shutdownPromise: Promise<void> | undefined;
  let handlersInstalled = false;
  let signalErrorReported = false;

  const removeSignalHandlers = () => {
    if (!handlersInstalled) return;
    handlersInstalled = false;
    for (const signal of SHUTDOWN_SIGNALS) {
      signalTarget.off(signal, handleSignal);
    }
  };

  const shutdown = (): Promise<void> => {
    shutdownPromise ??= Promise.resolve()
      .then(() => server.close())
      .finally(removeSignalHandlers);
    return shutdownPromise;
  };

  const handleSignal = () => {
    void shutdown().catch((error: unknown) => {
      if (signalErrorReported) return;
      signalErrorReported = true;
      onShutdownError(error);
    });
  };

  await server.listen({ host, port });

  for (const signal of SHUTDOWN_SIGNALS) {
    signalTarget.on(signal, handleSignal);
  }
  handlersInstalled = true;

  return { shutdown };
}
