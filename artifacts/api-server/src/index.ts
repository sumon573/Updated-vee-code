import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

// Graceful shutdown: stop accepting new connections, let in-flight requests
// finish, then exit. Force-exit if draining takes too long (e.g. a hung
// upstream keeps a socket open).
function shutdown(signal: NodeJS.Signals): void {
  logger.info({ signal }, "Received shutdown signal — draining connections");
  server.close((closeErr) => {
    if (closeErr) {
      logger.error({ err: closeErr }, "Error while closing HTTP server");
      process.exit(1);
    }
    logger.info("HTTP server closed cleanly");
    process.exit(0);
  });
  setTimeout(() => {
    logger.error("Graceful shutdown timed out — forcing exit");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Fail fast on programming errors: log and exit so the process supervisor
// restarts us into a clean state instead of serving in an unknown one.
process.on("unhandledRejection", (reason: unknown) => {
  logger.error({ reason }, "Unhandled promise rejection — exiting");
  process.exit(1);
});
process.on("uncaughtException", (err: Error) => {
  logger.error({ err }, "Uncaught exception — exiting");
  process.exit(1);
});
