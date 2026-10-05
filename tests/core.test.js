process.env.NODE_ENV = "test";
const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const { createApp } = require("../src/app");
const User = require("../src/models/User");
const Booking = require("../src/models/Booking");
const ParkingSpace = require("../src/models/ParkingSpace");
const {
  analyzeMigration,
  applyMigration,
} = require("../src/services/migration");
const { EJSON } = require("bson");
const { seed } = require("../src/services/seed");
const secret = "test-secret-that-is-longer-than-thirty-two-characters";
const config = {
  jwtSecret: secret,
  jwtExpiresIn: "1h",
  origins: ["http://localhost:3000"],
  maintenanceSecret: "maintenance-secret-that-is-separate-and-long",
};
let repl, server, base, alice, bob, lot, aliceToken, bobToken, temp;
const key = () => require("node:crypto").randomUUID();
async function request(
  url,
  {
    token = aliceToken,
    body,
    method = "GET",
    idempotencyKey,
    headers = {},
  } = {},
) {
  const response = await fetch(base + url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: response.status,
    data: await response.json(),
    headers: response.headers,
  };
}
const book = (overrides = {}, requestOptions = {}) =>
  request("/api/bookings", {
    method: "POST",
    body: {
      parkingSpaceId: String(lot._id),
      spotType: "normal",
      durationHours: 1,
      ...overrides,
    },
    idempotencyKey: key(),
    ...requestOptions,
  });
describe("Transactional API and migration", () => {
  before(async () => {
    temp = await fs.mkdtemp(path.join(os.tmpdir(), "parking-tests-"));
    repl = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: "wiredTiger" },
      binary: {
        downloadDir:
          process.env.MONGOMS_DOWNLOAD_DIR ||
          path.join(os.tmpdir(), "smart-parking-mongodb"),
      },
    });
    await mongoose.connect(repl.getUri("parking_tests"));
    await Promise.all([User.init(), Booking.init(), ParkingSpace.init()]);
    const app = createApp(config);
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    alice = await User.create({
      name: "Alice",
      email: "alice@example.com",
      password: await bcrypt.hash("password123", 4),
    });
    bob = await User.create({
      name: "Bob",
      email: "bob@example.com",
      password: await bcrypt.hash("password123", 4),
    });
    aliceToken = jwt.sign({ userId: String(alice._id) }, secret);
    bobToken = jwt.sign({ userId: String(bob._id) }, secret);
  });
  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    if (repl) await repl.stop();
    if (temp) await fs.rm(temp, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await Booking.deleteMany({});
    await ParkingSpace.deleteMany({});
    lot = await ParkingSpace.create({
      name: "Test lot",
      location: "Test road",
      capacity: 4,
      availableSpots: 4,
      pricePerHour: 50,
    });
  });
  it("requires verified tokens and rejects expired tokens", async () => {
    assert.equal((await book({}, { token: null })).status, 401);
    const expired = jwt.sign({ userId: String(alice._id) }, secret, {
      expiresIn: -1,
    });
    assert.equal(
      (await request("/api/bookings", { token: expired })).status,
      401,
    );
    assert.equal((await request("/api/auth/me")).data.email, alice.email);
  });
  it("normalizes registration and uses generic login errors", async () => {
    const email = `Case${Date.now()}@Example.com`;
    assert.equal(
      (
        await request("/api/auth/register", {
          method: "POST",
          token: null,
          body: { name: " Case ", email, password: "password123" },
        })
      ).status,
      201,
    );
    const login = await request("/api/auth/login", {
      method: "POST",
      token: null,
      body: { email: email.toUpperCase(), password: "password123" },
    });
    assert.equal(login.status, 200);
    assert.equal(login.data.email, email.toLowerCase());
    const missing = await request("/api/auth/login", {
      method: "POST",
      token: null,
      body: { email: "missing@example.com", password: "password123" },
    });
    const wrong = await request("/api/auth/login", {
      method: "POST",
      token: null,
      body: { email: alice.email, password: "wrong" },
    });
    assert.equal(missing.status, 401);
    assert.deepEqual(missing.data, wrong.data);
  });
  it("never exposes another user bookings or allows foreign cancellation", async () => {
    const created = await book();
    assert.equal(created.status, 201);
    const foreign = await request(`/api/bookings?userId=${alice._id}`, {
      token: bobToken,
    });
    assert.equal(foreign.data.total, 0);
    assert.equal(
      (
        await request(`/api/bookings/${created.data._id}/cancel`, {
          method: "POST",
          token: bobToken,
        })
      ).status,
      404,
    );
  });
  it("validates input and calculates prices on the server", async () => {
    for (const overrides of [
      { durationHours: 0 },
      { durationHours: 1.5 },
      { durationHours: 25 },
      { spotType: "unknown" },
      { parkingSpaceId: "bad" },
      { totalPrice: 1 },
      { userId: String(bob._id) },
      { payment: { status: "success" } },
    ])
      assert.equal((await book(overrides)).status, 400);
    assert.equal((await book({}, { idempotencyKey: "bad" })).status, 400);
    const result = await book({ spotType: "vip", durationHours: 2 });
    assert.equal(result.data.pricing.amountPaise, 20000);
    assert.equal(result.data.totalPrice, 200);
    assert.equal(result.data.payment.method, "simulated");
  });
  it("does not oversell the last spot under concurrent requests", async () => {
    await ParkingSpace.updateOne(
      { _id: lot._id },
      { $set: { capacity: 1, availableSpots: 1 } },
    );
    const results = await Promise.all(Array.from({ length: 8 }, () => book()));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(results.filter((r) => r.status === 409).length, 7);
    assert.equal(await Booking.countDocuments(), 1);
    assert.equal((await ParkingSpace.findById(lot._id)).availableSpots, 0);
  });
  it("replays retries and rejects reuse with different details", async () => {
    const idempotencyKey = key();
    const results = await Promise.all([
      book({}, { idempotencyKey }),
      book({}, { idempotencyKey }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 201]);
    assert.equal(results[0].data._id, results[1].data._id);
    assert.equal(
      (await book({ durationHours: 2 }, { idempotencyKey })).status,
      409,
    );
    assert.equal(await Booking.countDocuments(), 1);
  });
  it("rolls allocation back if booking persistence fails", async () => {
    const original = Booking.create;
    Booking.create = async () => {
      throw new Error("Injected booking failure");
    };
    try {
      assert.equal((await book()).status, 500);
    } finally {
      Booking.create = original;
    }
    assert.equal(await Booking.countDocuments(), 0);
    assert.equal((await ParkingSpace.findById(lot._id)).availableSpots, 4);
  });
  it("cancellation releases capacity exactly once, even concurrently", async () => {
    const created = await book(),
      url = `/api/bookings/${created.data._id}/cancel`;
    const results = await Promise.all([
      request(url, { method: "POST" }),
      request(url, { method: "POST" }),
    ]);
    assert.ok(results.every((r) => r.status === 200));
    assert.equal((await ParkingSpace.findById(lot._id)).availableSpots, 4);
    const summary = await request("/api/bookings/summary");
    assert.equal(summary.data.bookedHours, 0);
    assert.equal(summary.data.spentPaise, 5000);
    const history = await request("/api/bookings/history");
    assert.equal(history.data.items[0].status, "cancelled");
  });
  it("expires bookings, rejects cancelling completed bookings and frees slots", async () => {
    const created = await book();
    await Booking.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(created.data._id) },
      {
        $set: {
          startTime: new Date(Date.now() - 7200000),
          endTime: new Date(Date.now() - 3600000),
        },
      },
    );
    assert.equal((await request("/api/bookings/history")).data.total, 1);
    assert.equal(
      (
        await request(`/api/bookings/${created.data._id}/cancel`, {
          method: "POST",
        })
      ).status,
      409,
    );
    assert.equal((await ParkingSpace.findById(lot._id)).availableSpots, 4);
  });
  it("checks future legacy reservations for overlap without reducing current occupancy", async () => {
    const created = await book();
    await ParkingSpace.updateOne({ _id: lot._id }, { $set: { capacity: 1 } });
    await Booking.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(created.data._id) },
      {
        $set: {
          startTime: new Date(Date.now() + 3600000),
          endTime: new Date(Date.now() + 7200000),
        },
      },
    );
    assert.equal(
      (await request("/api/parking-spaces")).data[0].availableSpots,
      1,
    );
    assert.equal((await book({ durationHours: 3 })).status, 409);
  });
  it("paginates and returns stable booked pricing after rates change", async () => {
    const created = await book();
    await ParkingSpace.updateOne(
      { _id: lot._id },
      { $set: { pricePerHour: 99 } },
    );
    const listed = await request("/api/bookings?page=1&pageSize=1");
    assert.equal(listed.data.items[0].pricing.ratePaise, 5000);
    assert.equal(listed.data.total, 1);
    assert.equal((await request("/api/bookings?pageSize=101")).status, 400);
    assert.equal(created.data.parkingId, "S0001");
  });
  it("protects maintenance and applies explicit CORS origins", async () => {
    assert.equal(
      (
        await request("/api/maintenance/expire", {
          method: "POST",
          token: null,
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await request("/api/maintenance/expire", {
          method: "POST",
          token: config.maintenanceSecret,
        })
      ).status,
      200,
    );
    const response = await request("/api", {
      headers: { Origin: "https://untrusted.example" },
    });
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  });
  it("seeding is repeatable and preserves existing lots", async () => {
    await seed();
    const count = await ParkingSpace.countDocuments();
    await seed();
    assert.equal(await ParkingSpace.countDocuments(), count);
    assert.ok(await ParkingSpace.findById(lot._id));
  });
  it("backs up and migrates legacy bookings without altering quoted amounts or status", async () => {
    const legacy = {
      parkingSpaceId: lot._id,
      userId: String(alice._id),
      parkingId: "B7",
      spotType: "normal",
      parkingLotName: lot.name,
      startTime: new Date(),
      endTime: new Date(Date.now() + 3600000),
      totalPrice: 37.25,
      payment: {
        method: "card",
        cardNumber: "TEST-CARD-ONLY",
        status: "success",
      },
      status: "active",
      createdAt: new Date(),
    };
    const { insertedId } = await Booking.collection.insertOne(legacy);
    const report = await analyzeMigration(mongoose.connection.db);
    assert.equal(report.issues.length, 0);
    const result = await applyMigration(mongoose.connection.db, report, {
      backupDir: temp,
    });
    assert.equal(result.applied, true);
    const snapshot = EJSON.parse(await fs.readFile(result.backup, "utf8"));
    assert.equal(
      snapshot.collections.bookings[0].payment.cardNumber,
      "TEST-CARD-ONLY",
    );
    const updated = await Booking.collection.findOne({ _id: insertedId });
    assert.ok(updated.userId instanceof mongoose.Types.ObjectId);
    assert.equal(updated.totalPrice, 37.25);
    assert.equal(updated.pricing.amountPaise, 3725);
    assert.equal(updated.status, "active");
    assert.equal(updated.payment.cardNumber, undefined);
    assert.equal(updated.parkingId, "S0001");
    const repeated = await analyzeMigration(mongoose.connection.db);
    assert.equal(repeated.changes.length, 0);
    assert.equal(repeated.issues.length, 0);
  });
  it("does not require migration for healthy records or normal availability drift", async () => {
    await book();
    let report = await analyzeMigration(mongoose.connection.db);
    assert.equal(report.changes.length, 0, JSON.stringify(report.changes));
    assert.equal(report.issues.length, 0);
    await ParkingSpace.updateOne(
      { _id: lot._id },
      { $set: { availableSpots: 4 } },
    );
    report = await analyzeMigration(mongoose.connection.db);
    assert.equal(report.changes.length, 0);
  });
  it("flags integrity conflicts and stops conversion rather than dropping records", async () => {
    await ParkingSpace.updateOne({ _id: lot._id }, { $set: { capacity: 1 } });
    for (let i = 0; i < 2; i++)
      await Booking.collection.insertOne({
        parkingSpaceId: lot._id,
        userId: String(alice._id),
        parkingId: `B${i}`,
        spotType: "normal",
        parkingLotName: lot.name,
        startTime: new Date(),
        endTime: new Date(Date.now() + 3600000),
        totalPrice: 50,
        payment: { status: "success", cardNumber: "TEST" },
        status: "active",
      });
    const report = await analyzeMigration(mongoose.connection.db);
    assert.ok(report.issues.some((i) => i.message.includes("capacity")));
    const result = await applyMigration(mongoose.connection.db, report, {
      backupDir: temp,
    });
    assert.equal(result.applied, false);
    assert.equal(await Booking.countDocuments(), 2);
    assert.equal(
      (await ParkingSpace.findById(lot._id)).allocationBlocked,
      true,
    );
    assert.equal((await book()).status, 409);
  });
  it("reports orphan references and normalized email collisions", async () => {
    const orphan = await book();
    await Booking.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(orphan.data._id) },
      { $set: { userId: String(new mongoose.Types.ObjectId()) } },
    );
    const extra = new mongoose.Types.ObjectId();
    await User.collection.insertOne({
      _id: extra,
      name: "Collision",
      email: "ALICE@EXAMPLE.COM",
      password: "hash",
    });
    try {
      const report = await analyzeMigration(mongoose.connection.db);
      assert.ok(
        report.issues.some((i) => i.message === "Orphaned user reference"),
      );
      assert.ok(
        report.issues.some((i) => i.message === "Normalized email collision"),
      );
    } finally {
      await User.collection.deleteOne({ _id: extra });
    }
  });
});
