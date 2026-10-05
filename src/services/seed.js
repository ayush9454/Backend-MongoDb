const ParkingSpace = require("../models/ParkingSpace");
const samples = require("../../seed-data");
async function seed() {
  for (const [index, lot] of samples.entries()) {
    const seedKey = `demo-${index + 1}`;
    const existing = await ParkingSpace.findOne({
      $or: [{ seedKey }, { name: lot.name, location: lot.location }],
    });
    if (existing) {
      if (!existing.seedKey) {
        existing.seedKey = seedKey;
        await existing.save();
      }
      continue;
    }
    try {
      await ParkingSpace.updateOne(
        { seedKey },
        {
          $setOnInsert: {
            ...lot,
            seedKey,
            allocationVersion: 0,
            allocationBlocked: false,
          },
        },
        { upsert: true },
      );
    } catch (error) {
      if (error.code !== 11000 || !(await ParkingSpace.exists({ seedKey })))
        throw error;
    }
  }
}
module.exports = { seed };
