const { loadConfig } = require("./src/config/env");
const {
  connectDatabase,
  disconnectDatabase,
} = require("./src/config/database");
const { seed } = require("./src/services/seed");
(async () => {
  try {
    await connectDatabase(loadConfig(), { seed: false });
    await seed();
    console.log("Sample parking lots upserted; existing data preserved");
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
})();
