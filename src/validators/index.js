const mongoose = require("mongoose");
const { SPOT_TYPES } = require("@smart-parking/contracts");
const { ApiError } = require("../middleware/errors");
function invalid(message, fields) {
  throw new ApiError(400, "INVALID_INPUT", message, fields);
}
function objectId(value, field = "id") {
  if (typeof value !== "string" || !/^[a-fA-F0-9]{24}$/.test(value))
    invalid("Invalid identifier", { [field]: "Must be a MongoDB ObjectId" });
  return new mongoose.Types.ObjectId(value);
}
function credentials(body, registration = false) {
  const { email, password, name } = body || {};
  if (
    typeof email !== "string" ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  )
    invalid("Enter a valid email address");
  // bcrypt considers at most 72 UTF-8 bytes. Login accepts older, shorter passwords.
  if (
    typeof password !== "string" ||
    !password ||
    Buffer.byteLength(password) > 72 ||
    (registration && password.length < 8)
  )
    invalid("Password must contain 8–72 bytes for registration");
  if (
    registration &&
    (typeof name !== "string" || !name.trim() || name.trim().length > 100)
  )
    invalid("Name must contain 1–100 characters");
  return {
    email: email.trim().toLowerCase(),
    password,
    ...(registration ? { name: name.trim() } : {}),
  };
}
function bookingInput(body, key) {
  if (
    !body ||
    Object.keys(body).some(
      (k) => !["parkingSpaceId", "spotType", "durationHours"].includes(k),
    )
  )
    invalid("Only parkingSpaceId, spotType and durationHours are accepted");
  objectId(body.parkingSpaceId, "parkingSpaceId");
  if (!SPOT_TYPES.some((t) => t.value === body.spotType))
    invalid("Unsupported spot type");
  if (
    !Number.isInteger(body.durationHours) ||
    body.durationHours < 1 ||
    body.durationHours > 24
  )
    invalid("Duration must be an integer between 1 and 24 hours");
  if (typeof key !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(key))
    invalid(
      "Supply an Idempotency-Key of 16–128 letters, digits, underscores or hyphens",
    );
  return {
    parkingSpaceId: body.parkingSpaceId.toLowerCase(),
    spotType: body.spotType,
    durationHours: body.durationHours,
  };
}
function pagination(query) {
  const page = Number(query.page || 1),
    pageSize = Number(query.pageSize || 20);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 100000 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  )
    invalid("Invalid pagination");
  return { page, pageSize };
}
module.exports = { credentials, bookingInput, objectId, pagination };
