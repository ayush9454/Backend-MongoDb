const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Booking = require("../models/Booking");
const ParkingSpace = require("../models/ParkingSpace");
const { authenticate, maintenance } = require("../middleware/auth");
const rateLimit = require("../middleware/rateLimit");
const { ApiError, asyncRoute } = require("../middleware/errors");
const {
  credentials,
  bookingInput,
  objectId,
  pagination,
} = require("../validators");
const {
  createBooking,
  cancelBooking,
  reconcileAvailableSpots,
  populateBooking,
} = require("../services/bookings");
function publicUser(user) {
  return { userId: String(user._id), name: user.name, email: user.email };
}
function routes(config) {
  const router = express.Router(),
    auth = authenticate(config);
  router.post(
    "/auth/register",
    rateLimit(),
    asyncRoute(async (req, res) => {
      const input = credentials(req.body, true);
      if (await User.exists({ email: input.email }))
        throw new ApiError(409, "EMAIL_EXISTS", "Email already registered");
      try {
        await User.create({
          ...input,
          password: await bcrypt.hash(input.password, 12),
        });
      } catch (err) {
        if (err.code === 11000)
          throw new ApiError(409, "EMAIL_EXISTS", "Email already registered");
        throw err;
      }
      res.status(201).json({ message: "User registered successfully" });
    }),
  );
  router.post(
    "/auth/login",
    rateLimit(),
    asyncRoute(async (req, res) => {
      const input = credentials(req.body),
        user = await User.findOne({ email: input.email }).select("+password");
      // Use a fixed valid hash to perform equivalent work when the email is missing.
      const match = await bcrypt.compare(
        input.password,
        user?.password ||
          "$2a$12$gkOIQWaqRWbhDlGBXRge6etLIYCsGaRiKBmPTqxlfYS0TGq1tNC1K",
      );
      if (!user || !match)
        throw new ApiError(
          401,
          "INVALID_CREDENTIALS",
          "Invalid email or password",
        );
      res.json({
        ...publicUser(user),
        token: jwt.sign({ userId: String(user._id) }, config.jwtSecret, {
          algorithm: "HS256",
          expiresIn: config.jwtExpiresIn,
        }),
      });
    }),
  );
  router.get("/auth/me", auth, (req, res) => res.json(publicUser(req.user)));
  router.get(
    "/parking-spaces",
    asyncRoute(async (req, res) => {
      await reconcileAvailableSpots();
      res.json(await ParkingSpace.find().sort({ name: 1 }));
    }),
  );
  router.get(
    "/parking-spaces/:id",
    asyncRoute(async (req, res) => {
      const id = objectId(req.params.id);
      await reconcileAvailableSpots();
      const lot = await ParkingSpace.findById(id);
      if (!lot) throw new ApiError(404, "NOT_FOUND", "Parking lot not found");
      res.json(lot);
    }),
  );
  router.use("/bookings", auth);
  router.post(
    "/bookings",
    rateLimit({ limit: 60 }),
    asyncRoute(async (req, res) => {
      const input = bookingInput(req.body, req.get("Idempotency-Key"));
      const result = await createBooking(
        req.user._id,
        input,
        req.get("Idempotency-Key"),
      );
      res
        .status(result.replayed ? 200 : 201)
        .json(await populateBooking(result.booking));
    }),
  );
  router.get(
    "/bookings/summary",
    asyncRoute(async (req, res) => {
      await reconcileAvailableSpots();
      const [summary] = await Booking.aggregate([
        { $match: { userId: req.user._id } },
        {
          $group: {
            _id: null,
            activeBookings: {
              $sum: {
                $cond: [{ $in: ["$status", ["active", "confirmed"]] }, 1, 0],
              },
            },
            bookedHours: {
              $sum: {
                $cond: [
                  { $ne: ["$status", "cancelled"] },
                  {
                    $divide: [
                      { $subtract: ["$endTime", "$startTime"] },
                      3600000,
                    ],
                  },
                  0,
                ],
              },
            },
            spentPaise: {
              $sum: {
                $cond: [
                  { $eq: ["$payment.status", "success"] },
                  "$pricing.amountPaise",
                  0,
                ],
              },
            },
          },
        },
      ]);
      res.json(
        summary
          ? {
              activeBookings: summary.activeBookings,
              bookedHours: summary.bookedHours,
              spentPaise: summary.spentPaise,
            }
          : { activeBookings: 0, bookedHours: 0, spentPaise: 0 },
      );
    }),
  );
  const list = (history) =>
    asyncRoute(async (req, res) => {
      await reconcileAvailableSpots();
      const { page, pageSize } = pagination(req.query);
      const filter = { userId: req.user._id };
      if (history) filter.status = { $in: ["completed", "cancelled"] };
      else if (req.query.status === "current")
        filter.status = { $in: ["active", "confirmed"] };
      else if (req.query.status)
        throw new ApiError(400, "INVALID_INPUT", "Unsupported status filter");
      const [items, total] = await Promise.all([
        Booking.find(filter)
          .sort({ createdAt: -1, _id: -1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .populate("parkingSpaceId"),
        Booking.countDocuments(filter),
      ]);
      res.json({ items, total, page, pageSize });
    });
  router.get("/bookings", list(false));
  router.get("/bookings/history", list(true));
  router.post(
    "/bookings/:id/cancel",
    asyncRoute(async (req, res) => {
      const id = objectId(req.params.id);
      const booking = await cancelBooking(req.user._id, id);
      res.json(await populateBooking(booking));
    }),
  );
  router.post(
    "/maintenance/expire",
    maintenance(config),
    asyncRoute(async (req, res) => {
      await reconcileAvailableSpots();
      res.json({ message: "Expiry and availability reconciliation completed" });
    }),
  );
  return router;
}
module.exports = routes;
