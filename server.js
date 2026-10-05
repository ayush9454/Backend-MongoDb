const { loadConfig } = require("./src/config/env");
const {
  connectDatabase,
  disconnectDatabase,
} = require("./src/config/database");
const { createApp } = require("./src/app");
const { startExpiryJob } = require("./src/jobs/expiry");
const config = loadConfig();
const app = createApp(config, { connect: () => connectDatabase(config) });
async function startServer() {
  await connectDatabase(config);
  const stopJob = startExpiryJob();
  const server = app.listen(config.port, () =>
    console.log(
      JSON.stringify({
        level: "info",
        message: "API listening",
        port: config.port,
      }),
    ),
  );
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    stopJob();
    const timeout = setTimeout(() => process.exit(1), 10000);
    timeout.unref();
    server.close(async () => {
      try {
        await disconnectDatabase();
        clearTimeout(timeout);
        process.exit(0);
      } catch {
        process.exit(1);
      }
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  server.on("error", async (err) => {
    stopJob();
    await disconnectDatabase();
    console.error(err.message);
    process.exitCode = 1;
  });
  return server;
}
if (require.main === module)
  startServer().catch(async (err) => {
    console.error(JSON.stringify({ level: "error", message: err.message }));
    await disconnectDatabase();
    process.exitCode = 1;
  });
module.exports = app;
