import { createApp } from "./app";
import { config } from "./config";
import { closeDb } from "./db";
import {
  startOutboxRelay,
  stopOutboxRelay,
  closeOutboxQueue,
  startSlaEvaluationScheduler,
  stopSlaEvaluationScheduler,
} from "./jobs";

const app = createApp();

const server = app.listen(config.PORT, () => {
  console.log(`API server listening on port ${config.PORT} in ${config.NODE_ENV} mode`);
  if (config.NODE_ENV !== "test") {
    startOutboxRelay(3000);
    startSlaEvaluationScheduler(60000);
  }
});

async function gracefulShutdown(signal: string) {
  console.log(`Received ${signal}, shutting down gracefully...`);
  stopOutboxRelay();
  stopSlaEvaluationScheduler();
  await closeOutboxQueue();
  server.close(async () => {
    await closeDb();
    process.exit(0);
  });
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

export default server;
