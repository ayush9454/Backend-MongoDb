const mongoose = require("mongoose");
const path = require("node:path");
const fs = require("node:fs");
const { backendDir } = require("./env");
let promise,
  embedded,
  initialized = false;
async function connectDatabase(
  config,
  {
    seed = true,
    skipIntegrity = false,
    localPath = path.join(backendDir, ".mongo_data"),
  } = {},
) {
  if (initialized && mongoose.connection.readyState === 1) return;
  if (promise) return promise;
  promise = (async () => {
    let uri = config.mongoUri;
    if (!uri) {
      // Snapshot legacy local data before MongoDB opens or upgrades its files.
      if (
        fs.existsSync(localPath) &&
        fs.readdirSync(localPath).length &&
        !fs.existsSync(path.join(localPath, ".replica-backup-complete"))
      ) {
        const lockFile = path.join(localPath, "mongod.lock");
        if (fs.existsSync(lockFile)) {
          const pid = Number(fs.readFileSync(lockFile, "utf8").trim());
          if (pid > 0) {
            let running = true;
            try {
              process.kill(pid, 0);
            } catch (err) {
              if (err.code === "ESRCH") running = false;
              else throw err;
            }
            if (running)
              throw new Error(
                "Stop the existing MongoDB process before backing up local data",
              );
          }
        }
        const backup = `${localPath}.backup-${Date.now()}`;
        fs.cpSync(localPath, backup, { recursive: true });
        fs.writeFileSync(
          path.join(localPath, ".replica-backup-complete"),
          backup,
        );
      }
      fs.mkdirSync(localPath, { recursive: true });
      const settingsFile = `${localPath}.config.json`;
      const settings = fs.existsSync(settingsFile)
        ? JSON.parse(fs.readFileSync(settingsFile, "utf8"))
        : {};
      const net = require("node:net");
      const probe = net.createServer();
      await new Promise((resolve, reject) => {
        probe.once("error", (error) =>
          reject(
            error.code !== "EADDRINUSE"
              ? error
              : new Error(
                  "The persistent embedded MongoDB port is occupied; stop the other process before startup",
                ),
          ),
        );
        probe.listen(settings.port || 0, "127.0.0.1", resolve);
      });
      const port = probe.address().port;
      await new Promise((resolve) => probe.close(resolve));
      fs.writeFileSync(settingsFile, JSON.stringify({ port }), { mode: 0o600 });
      const { MongoMemoryReplSet } = require("mongodb-memory-server");
      embedded = await MongoMemoryReplSet.create({
        instanceOpts: [{ dbPath: localPath, port }],
        replSet: { count: 1, storageEngine: "wiredTiger" },
      });
      uri = embedded.getUri("parking_system");
    }
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
      autoIndex: false,
    });
    // The previous embedded server used the MongoDB 'test' database by default.
    if (
      !config.mongoUri &&
      !(await mongoose.connection.db
        .collection("parkingspaces")
        .countDocuments())
    ) {
      const legacy = mongoose.connection.client.db("test");
      if (
        (await legacy.collection("parkingspaces").countDocuments()) ||
        (await legacy.collection("users").countDocuments()) ||
        (await legacy.collection("bookings").countDocuments())
      ) {
        await mongoose.disconnect();
        await mongoose.connect(uri, {
          dbName: "test",
          serverSelectionTimeoutMS: 10000,
          autoIndex: false,
        });
        console.log(
          JSON.stringify({
            level: "info",
            message: "Using preserved legacy local database: test",
          }),
        );
      }
    }
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    if (!hello.setName && hello.msg !== "isdbgrid")
      throw new Error("MongoDB must be a replica set or sharded cluster");
    const { analyzeMigration } = require("../services/migration");
    const report = skipIntegrity
      ? { changes: [], issues: [] }
      : await analyzeMigration(mongoose.connection.db);
    if (report.changes.length || report.issues.length)
      throw new Error(
        "Existing data requires review: run npm run migrate -- --dry-run, then apply the migration.",
      );
    if (!skipIntegrity)
      await Promise.all([
        require("../models/User").createIndexes(),
        require("../models/ParkingSpace").createIndexes(),
        require("../models/Booking").createIndexes(),
      ]);
    if (seed) await require("../services/seed").seed();
    if (!skipIntegrity)
      await require("../services/bookings").reconcileAvailableSpots();
    initialized = true;
  })();
  try {
    await promise;
  } catch (err) {
    initialized = false;
    await mongoose.disconnect();
    if (embedded) {
      await embedded.stop({ doCleanup: false });
      embedded = null;
    }
    throw err;
  } finally {
    promise = null;
  }
}
async function disconnectDatabase() {
  initialized = false;
  await mongoose.disconnect();
  if (embedded) {
    await embedded.stop({ doCleanup: false });
    embedded = null;
  }
}
module.exports = { connectDatabase, disconnectDatabase };
