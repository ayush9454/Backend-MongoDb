const path = require("node:path");
const mongoose = require("mongoose");
const { loadConfig, backendDir } = require("../src/config/env");
const {
  connectDatabase,
  disconnectDatabase,
} = require("../src/config/database");
const {
  analyzeMigration,
  applyMigration,
} = require("../src/services/migration");
(async () => {
  try {
    await connectDatabase(loadConfig(), { seed: false, skipIntegrity: true });
    const report = await analyzeMigration(mongoose.connection.db);
    console.log(
      JSON.stringify(
        { changes: report.changes.length, issues: report.issues },
        null,
        2,
      ),
    );
    if (process.argv.includes("--dry-run")) {
      if (report.issues.length) process.exitCode = 2;
      return;
    }
    const result = await applyMigration(mongoose.connection.db, report, {
      backupDir: path.join(backendDir, "backups"),
    });
    console.log(JSON.stringify(result));
    if (!result.applied) {
      console.error(
        "Migration stopped. Integrity flags recorded; resolve reported conflicts and rerun the dry run.",
      );
      process.exitCode = 2;
    }
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
})();
