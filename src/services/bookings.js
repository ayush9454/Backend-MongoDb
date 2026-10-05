const crypto = require("node:crypto");
const mongoose = require("mongoose");
const { SPOT_TYPES } = require("@smart-parking/contracts");
const Booking = require("../models/Booking");
const ParkingSpace = require("../models/ParkingSpace");
const { ApiError } = require("../middleware/errors");
const liveStatuses = ["active", "confirmed"];
const activeAt = (now) => ({
  status: { $in: liveStatuses },
  startTime: { $lte: now },
  endTime: { $gt: now },
});
async function transaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(
      async () => {
        result = await fn(session);
      },
      { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
    );
    return result;
  } finally {
    await session.endSession();
  }
}
async function lockLot(id, session) {
  const lot = await ParkingSpace.findOneAndUpdate(
    { _id: id },
    { $inc: { allocationVersion: 1 } },
    { new: true, session },
  );
  if (!lot) throw new ApiError(404, "NOT_FOUND", "Parking lot not found");
  return lot;
}
async function refreshLot(lot, session, now) {
  await Booking.updateMany(
    {
      parkingSpaceId: lot._id,
      status: { $in: liveStatuses },
      endTime: { $lte: now },
    },
    { $set: { status: "completed" } },
    { session },
  );
  const active = await Booking.find({
    parkingSpaceId: lot._id,
    ...activeAt(now),
  }).session(session);
  const reserved = await Booking.find({
    parkingSpaceId: lot._id,
    status: { $in: liveStatuses },
    endTime: { $gt: now },
  }).session(session);
  // Future legacy bookings still reserve their assigned spots for overlapping immediate requests.
  lot.availableSpots = Math.max(0, lot.capacity - active.length);
  if (
    reserved.some((b) => b.migrationIssues?.length) ||
    active.length > lot.capacity
  )
    lot.allocationBlocked = true;
  await lot.save({ session });
  return reserved;
}
function fingerprint(input) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
}
function verifyReplay(booking, hash) {
  if (booking.requestFingerprint !== hash)
    throw new ApiError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "This request key was already used for different booking details",
    );
  return booking;
}
async function createBooking(userId, input, key) {
  const hash = fingerprint(input);
  const prior = await Booking.findOne({ userId, idempotencyKey: key });
  if (prior) return { booking: verifyReplay(prior, hash), replayed: true };
  try {
    return await transaction(async (session) => {
      const lot = await lockLot(input.parkingSpaceId, session);
      const existing = await Booking.findOne({
        userId,
        idempotencyKey: key,
      }).session(session);
      if (existing)
        return { booking: verifyReplay(existing, hash), replayed: true };
      if (lot.allocationBlocked)
        throw new ApiError(
          409,
          "ALLOCATION_BLOCKED",
          "This lot needs a data integrity review before new bookings",
        );
      const now = new Date(),
        end = new Date(now.getTime() + input.durationHours * 3600000);
      const reserved = await refreshLot(lot, session, now);
      if (lot.allocationBlocked)
        throw new ApiError(
          409,
          "ALLOCATION_BLOCKED",
          "This lot needs a data integrity review before new bookings",
        );
      const occupied = new Set(
        reserved
          .filter((b) => b.startTime < end && b.endTime > now)
          .map((b) => b.parkingId),
      );
      let spot;
      for (let i = 1; i <= lot.capacity; i++) {
        const id = `S${String(i).padStart(4, "0")}`;
        if (!occupied.has(id)) {
          spot = id;
          break;
        }
      }
      if (!spot || lot.availableSpots <= 0)
        throw new ApiError(
          409,
          "NO_CAPACITY",
          "No spot is available for this duration",
        );
      const multiplier = SPOT_TYPES.find(
        (t) => t.value === input.spotType,
      ).multiplier;
      const baseRatePaise = Math.round(lot.pricePerHour * 100),
        ratePaise = Math.round(baseRatePaise * multiplier),
        amountPaise = ratePaise * input.durationHours;
      const [booking] = await Booking.create(
        [
          {
            parkingSpaceId: lot._id,
            userId,
            parkingId: spot,
            spotType: input.spotType,
            parkingLotName: lot.name,
            startTime: now,
            endTime: end,
            totalPrice: amountPaise / 100,
            pricing: {
              currency: "INR",
              baseRatePaise,
              ratePaise,
              multiplier,
              durationHours: input.durationHours,
              amountPaise,
            },
            payment: {
              method: "simulated",
              status: "success",
              reference: crypto.randomUUID(),
            },
            status: "active",
            idempotencyKey: key,
            requestFingerprint: hash,
          },
        ],
        { session },
      );
      lot.availableSpots -= 1;
      await lot.save({ session });
      return { booking, replayed: false };
    });
  } catch (err) {
    if (err.code === 11000) {
      const existing = await Booking.findOne({ userId, idempotencyKey: key });
      if (existing)
        return { booking: verifyReplay(existing, hash), replayed: true };
    }
    throw err;
  }
}
async function cancelBooking(userId, id) {
  return transaction(async (session) => {
    const initial = await Booking.findOne({ _id: id, userId }).session(session);
    if (!initial) throw new ApiError(404, "NOT_FOUND", "Booking not found");
    const lot = await lockLot(initial.parkingSpaceId, session);
    await refreshLot(lot, session, new Date());
    const booking = await Booking.findOne({ _id: id, userId }).session(session);
    if (booking.status === "cancelled") return booking;
    if (!liveStatuses.includes(booking.status))
      throw new ApiError(
        409,
        "INVALID_STATE",
        "Only active or confirmed bookings can be cancelled",
      );
    booking.status = "cancelled";
    booking.cancelledAt = new Date();
    booking.cancellationReason = "Cancelled by user";
    await booking.save({ session });
    await refreshLot(lot, session, new Date());
    return booking;
  });
}
async function reconcileAvailableSpots() {
  const lots = await ParkingSpace.find().select("_id");
  for (const lot of lots)
    await transaction(async (session) => {
      const locked = await lockLot(lot._id, session);
      await refreshLot(locked, session, new Date());
    });
}
async function populateBooking(booking) {
  return Booking.findById(booking._id).populate("parkingSpaceId");
}
module.exports = {
  createBooking,
  cancelBooking,
  reconcileAvailableSpots,
  populateBooking,
  activeAt,
  transaction,
};
