const fs = require("node:fs/promises");
const path = require("node:path");
const { EJSON, ObjectId } = require("bson");
const { SPOT_TYPES } = require("@smart-parking/contracts");
const equal = (a, b) => EJSON.stringify(a) === EJSON.stringify(b);
const id = (value) => String(value);
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
function oid(value) {
  return /^[a-fA-F0-9]{24}$/.test(String(value))
    ? new ObjectId(String(value))
    : null;
}
async function analyzeMigration(db, now = new Date()) {
  const [users, lots, bookings] = await Promise.all(
    ["users", "parkingspaces", "bookings"].map((name) =>
      db.collection(name).find().toArray(),
    ),
  );
  const userIds = new Set(users.map((u) => id(u._id))),
    lotMap = new Map(lots.map((l) => [id(l._id), l]));
  const issues = [],
    changes = [],
    emails = new Map(),
    blocked = new Map();
  function issue(collection, record, message, lotId) {
    issues.push({ collection, id: id(record._id), message });
    if (lotId) {
      const key = id(lotId);
      blocked.set(key, [...(blocked.get(key) || []), message]);
    }
  }
  function update(collection, record, values, unset = {}) {
    const set = Object.fromEntries(
      Object.entries(values).filter(
        ([key, value]) => !equal(record[key], value),
      ),
    );
    const remove = Object.fromEntries(
      Object.entries(unset).filter(
        ([key]) =>
          Object.hasOwn(record, key) &&
          !(
            key === "migrationIssues" &&
            Array.isArray(record[key]) &&
            record[key].length === 0
          ),
      ),
    );
    if (Object.keys(set).length || Object.keys(remove).length)
      changes.push({
        collection,
        id: record._id,
        update: {
          $set: set,
          ...(Object.keys(remove).length ? { $unset: remove } : {}),
        },
      });
  }
  for (const user of users) {
    const email =
      typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      issue("users", user, "Invalid email");
    if (emails.has(email)) {
      issue("users", user, "Normalized email collision");
      issue("users", emails.get(email), "Normalized email collision");
    }
    emails.set(email, user);
    update("users", user, {
      email,
      updatedAt: user.updatedAt || user.createdAt || now,
    });
  }
  const grouped = new Map();
  for (const booking of bookings) {
    const lot = lotMap.get(id(booking.parkingSpaceId));
    const userId = oid(booking.userId),
      start = new Date(booking.startTime),
      end = new Date(booking.endTime);
    if (!userId || !userIds.has(id(userId)))
      issue(
        "bookings",
        booking,
        "Orphaned user reference",
        booking.parkingSpaceId,
      );
    if (!lot) issue("bookings", booking, "Orphaned parking lot reference");
    if (!Number.isFinite(+start) || !Number.isFinite(+end) || end <= start)
      issue(
        "bookings",
        booking,
        "Invalid booking interval",
        booking.parkingSpaceId,
      );
    if (
      typeof booking.totalPrice !== "number" ||
      !Number.isFinite(booking.totalPrice) ||
      booking.totalPrice < 0 ||
      !integer(Math.round(booking.totalPrice * 100))
    )
      issue(
        "bookings",
        booking,
        "Invalid quoted amount",
        booking.parkingSpaceId,
      );
    if (!SPOT_TYPES.some((t) => t.value === booking.spotType))
      issue(
        "bookings",
        booking,
        "Unsupported spot type",
        booking.parkingSpaceId,
      );
    if (
      !["pending", "active", "confirmed", "cancelled", "completed"].includes(
        booking.status,
      )
    )
      issue("bookings", booking, "Unknown status", booking.parkingSpaceId);
    if (
      ["pending", "active", "confirmed"].includes(booking.status) &&
      end > now
    ) {
      if (booking.status === "pending")
        issue(
          "bookings",
          booking,
          "Pending legacy booking needs manual resolution",
          booking.parkingSpaceId,
        );
      const key = id(booking.parkingSpaceId);
      grouped.set(key, [...(grouped.get(key) || []), booking]);
    }
    const durationHours = (end - start) / 3600000,
      amountPaise = Math.round(booking.totalPrice * 100);
    const multiplier =
      SPOT_TYPES.find((t) => t.value === booking.spotType)?.multiplier || 1;
    const pricing = booking.pricing || {
      currency: "INR",
      amountPaise,
      ratePaise: Math.round(amountPaise / durationHours),
      baseRatePaise: Math.round(amountPaise / durationHours / multiplier),
      multiplier,
      durationHours,
      legacyQuote: true,
    };
    if (
      booking.pricing &&
      (booking.pricing.amountPaise !== amountPaise ||
        !integer(booking.pricing.amountPaise))
    )
      issue(
        "bookings",
        booking,
        "Pricing does not match preserved quoted amount",
        booking.parkingSpaceId,
      );
    const payment = {
      method: "simulated",
      status: booking.payment?.status === "success" ? "success" : "legacy",
      ...(typeof booking.payment?.reference === "string"
        ? { reference: booking.payment.reference }
        : {}),
    };
    update(
      "bookings",
      booking,
      {
        ...(userId ? { userId } : {}),
        pricing,
        payment,
        updatedAt: booking.updatedAt || booking.createdAt || now,
      },
      { migrationIssues: "" },
    );
  }
  for (const lot of lots) {
    if (
      !Number.isInteger(lot.capacity) ||
      lot.capacity < 0 ||
      lot.capacity > 10000 ||
      typeof lot.pricePerHour !== "number" ||
      !Number.isFinite(lot.pricePerHour) ||
      lot.pricePerHour < 0
    )
      issue("parkingspaces", lot, "Invalid capacity or hourly rate", lot._id);
    const active = (grouped.get(id(lot._id)) || []).sort(
      (a, b) =>
        +new Date(a.startTime) - +new Date(b.startTime) ||
        id(a._id).localeCompare(id(b._id)),
    );
    const assigned = [];
    for (const booking of active) {
      const overlapping = assigned.filter(
        (b) =>
          new Date(b.startTime) < new Date(booking.endTime) &&
          new Date(b.endTime) > new Date(booking.startTime),
      );
      const used = new Set(overlapping.map((b) => b.parkingId));
      let spot =
        /^S\d{4,}$/.test(booking.parkingId) &&
        Number(booking.parkingId.slice(1)) >= 1 &&
        Number(booking.parkingId.slice(1)) <= lot.capacity &&
        !used.has(booking.parkingId)
          ? booking.parkingId
          : null;
      for (let number = 1; !spot && number <= lot.capacity; number++) {
        const candidate = `S${String(number).padStart(4, "0")}`;
        if (!used.has(candidate)) spot = candidate;
      }
      if (!spot)
        issue(
          "bookings",
          booking,
          "Overlapping reservations exceed capacity",
          lot._id,
        );
      else {
        assigned.push({ ...booking, parkingId: spot });
        update("bookings", booking, { parkingId: spot });
      }
    }
    const current = active.filter(
      (b) => new Date(b.startTime) <= now && new Date(b.endTime) > now,
    ).length;
    update(
      "parkingspaces",
      lot,
      {
        ...(lot.allocationVersion === undefined || !integer(lot.availableSpots)
          ? { availableSpots: Math.max(0, lot.capacity - current) }
          : {}),
        allocationVersion: lot.allocationVersion || 0,
        allocationBlocked: false,
        updatedAt: lot.updatedAt || lot.createdAt || now,
      },
      { migrationIssues: "" },
    );
  }
  return { changes, issues, blocked };
}
async function backupDatabase(db, folder) {
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  const collections = (await db.listCollections().toArray())
    .filter((c) => !c.name.startsWith("system."))
    .map((c) => c.name);
  const snapshot = {
    database: db.databaseName,
    createdAt: new Date(),
    collections: {},
  };
  for (const name of collections)
    snapshot.collections[name] = await db.collection(name).find().toArray();
  const file = path.join(folder, `backup-${Date.now()}.json`);
  await fs.writeFile(
    file,
    EJSON.stringify(snapshot, null, 2, { relaxed: false }),
    { mode: 0o600, flag: "wx" },
  );
  return file;
}
async function applyMigration(db, report, { backupDir }) {
  const backup = await backupDatabase(db, backupDir);
  const session = db.client
    ? db.client.startSession()
    : require("mongoose").connection.client.startSession();
  try {
    await session.withTransaction(
      async () => {
        if (report.issues.length) {
          for (const [lotId, messages] of report.blocked)
            if (oid(lotId))
              await db.collection("parkingspaces").updateOne(
                { _id: oid(lotId) },
                {
                  $set: {
                    allocationBlocked: true,
                    migrationIssues: [...new Set(messages)],
                  },
                },
                { session },
              );
          for (const entry of report.issues.filter(
            (i) => i.collection === "bookings",
          ))
            await db
              .collection("bookings")
              .updateOne(
                { _id: oid(entry.id) },
                { $addToSet: { migrationIssues: entry.message } },
                { session },
              );
        } else {
          for (const change of report.changes)
            await db
              .collection(change.collection)
              .updateOne({ _id: change.id }, change.update, { session });
        }
      },
      { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
    );
  } finally {
    await session.endSession();
  }
  return { backup, applied: !report.issues.length };
}
module.exports = { analyzeMigration, applyMigration, backupDatabase };
