const mongoose = require("mongoose");
const integer = (value) => Number.isSafeInteger(value);
const schema = new mongoose.Schema(
  {
    seedKey: { type: String },
    name: { type: String, required: true },
    location: { type: String, required: true },
    capacity: {
      type: Number,
      required: true,
      min: 0,
      max: 10000,
      validate: integer,
    },
    availableSpots: { type: Number, required: true, min: 0, validate: integer },
    pricePerHour: { type: Number, required: true, min: 0 },
    allocationVersion: { type: Number, default: 0 },
    allocationBlocked: { type: Boolean, default: false },
    migrationIssues: [String],
  },
  { timestamps: true },
);
schema.index(
  { seedKey: 1 },
  { unique: true, partialFilterExpression: { seedKey: { $type: "string" } } },
);
module.exports = mongoose.model("ParkingSpace", schema);
