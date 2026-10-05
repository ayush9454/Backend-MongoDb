const mongoose = require("mongoose");
const { SPOT_TYPES } = require("@smart-parking/contracts");
const safeInteger = (value) => Number.isSafeInteger(value);
const money = { type: Number, required: true, min: 0, validate: safeInteger };
const pricing = new mongoose.Schema(
  {
    currency: { type: String, enum: ["INR"], default: "INR" },
    baseRatePaise: money,
    ratePaise: money,
    multiplier: { type: Number, required: true, min: 0 },
    durationHours: { type: Number, required: true, min: 0 },
    amountPaise: money,
    legacyQuote: { type: Boolean, default: false },
  },
  { _id: false },
);
const payment = new mongoose.Schema(
  {
    method: { type: String, enum: ["simulated"], default: "simulated" },
    status: { type: String, enum: ["success", "legacy"], required: true },
    reference: String,
  },
  { _id: false },
);
const schema = new mongoose.Schema(
  {
    parkingSpaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ParkingSpace",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    parkingId: { type: String, required: true },
    spotType: {
      type: String,
      enum: SPOT_TYPES.map((x) => x.value),
      required: true,
    },
    parkingLotName: { type: String, required: true },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    totalPrice: { type: Number, required: true, min: 0 },
    pricing: { type: pricing, required: true },
    payment: { type: payment, required: true },
    status: {
      type: String,
      enum: ["pending", "active", "confirmed", "cancelled", "completed"],
      default: "active",
    },
    idempotencyKey: String,
    requestFingerprint: String,
    cancelledAt: Date,
    cancellationReason: String,
    migrationIssues: [String],
  },
  { timestamps: true },
);
schema.pre("validate", function () {
  if (!(this.endTime > this.startTime))
    this.invalidate("endTime", "End time must follow start time");
});
schema.index({ userId: 1, status: 1, createdAt: -1 });
schema.index({ userId: 1, createdAt: -1 });
schema.index({ parkingSpaceId: 1, status: 1, endTime: 1, startTime: 1 });
schema.index(
  { userId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
  },
);
module.exports = mongoose.model("Booking", schema);
