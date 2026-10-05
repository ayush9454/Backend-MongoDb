const fs = require("node:fs/promises");
const { EJSON } = require("bson");
const mongoose = require("mongoose");
const { loadConfig, backendDir } = require("../src/config/env");
const path = require("node:path");
const {
  connectDatabase,
  disconnectDatabase,
} = require("../src/config/database");
const { backupDatabase } = require("../src/services/migration");
(async () => {
  try {
    const file = process.argv[2];
    if (!file)
      throw new Error("Usage: npm run restore -- <backup.json> [--replace]");
    const snapshot = EJSON.parse(await fs.readFile(file, "utf8"), {
      relaxed: false,
    });
    if (!snapshot.collections || typeof snapshot.collections !== "object")
      throw new Error("Invalid backup");
    await connectDatabase(loadConfig(), { seed: false, skipIntegrity: true });
    const db = mongoose.connection.db;
    if (snapshot.database !== db.databaseName)
      throw new Error("Backup database does not match the configured target");
    const existing = (await db.listCollections().toArray()).filter(
      (c) => !c.name.startsWith("system."),
    );
    if (existing.length && !process.argv.includes("--replace"))
      throw new Error("Target is not empty; --replace is required");
    const backup = await backupDatabase(db, path.join(backendDir, "backups"));
    console.log(`Pre-restore backup: ${backup}`);
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        for (const name of new Set([
          ...existing.map((c) => c.name),
          ...Object.keys(snapshot.collections),
        ])) {
          if (name.startsWith("system."))
            throw new Error("Cannot restore system collections");
          await db.collection(name).deleteMany({}, { session });
          const records = snapshot.collections[name] || [];
          if (records.length)
            await db.collection(name).insertMany(records, { session });
        }
      });
    } finally {
      await session.endSession();
    }
    console.log("Restore complete; run migration dry run before startup");
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
})();
