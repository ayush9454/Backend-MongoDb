process.env.MONGOMS_DOWNLOAD_DIR =
  process.env.MONGOMS_DOWNLOAD_DIR ||
  require("node:path").join(
    require("node:os").tmpdir(),
    "smart-parking-mongodb",
  );
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const {
  connectDatabase,
  disconnectDatabase,
} = require("../src/config/database");
const User = require("../src/models/User");
const ParkingSpace = require("../src/models/ParkingSpace");
const Booking = require("../src/models/Booking");
const { createBooking } = require("../src/services/bookings");
async function worker(folder, phase) {
  try {
    await connectDatabase(
      { mongoUri: null },
      { localPath: path.join(folder, "data") },
    );
    const recordFile = path.join(folder, "records.json");
    if (phase === "init") {
      const user = await User.create({
        name: "Persistence test",
        email: "restart@example.com",
        password: "test-only-hash",
      });
      const lot = await ParkingSpace.findOne();
      const { booking } = await createBooking(
        user._id,
        {
          parkingSpaceId: String(lot._id),
          spotType: "normal",
          durationHours: 1,
        },
        require("node:crypto").randomUUID(),
      );
      await fs.writeFile(
        recordFile,
        JSON.stringify({
          userId: user._id,
          lotId: lot._id,
          bookingId: booking._id,
          capacity: lot.capacity,
        }),
      );
    } else {
      const saved = JSON.parse(await fs.readFile(recordFile, "utf8"));
      assert.ok(await User.findById(saved.userId));
      assert.ok(await Booking.findById(saved.bookingId));
      assert.equal(
        (await ParkingSpace.findById(saved.lotId)).availableSpots,
        saved.capacity - 1,
      );
      console.log(
        `Restart ${phase}: users, booking and availability preserved`,
      );
    }
  } finally {
    await disconnectDatabase();
  }
}
async function runPhase(folder, phase) {
  const child = spawn(
    process.execPath,
    [__filename, "--worker", folder, phase],
    { stdio: "inherit" },
  );
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Persistence phase ${phase} failed`)),
    );
  });
}
(async () => {
  if (process.argv[2] === "--worker") {
    await worker(process.argv[3], process.argv[4]);
    return;
  }
  const folder = await fs.mkdtemp(
    path.join(os.tmpdir(), "parking-persistence-"),
  );
  try {
    await runPhase(folder, "init");
    await runPhase(folder, "1");
    await runPhase(folder, "2");
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
