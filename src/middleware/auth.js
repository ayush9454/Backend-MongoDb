const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");
const User = require("../models/User");
const { ApiError, asyncRoute } = require("./errors");
const { objectId } = require("../validators");
function authenticate(config) {
  return asyncRoute(async (req, res, next) => {
    const header = req.get("Authorization") || "";
    let claims;
    try {
      if (!header.startsWith("Bearer ")) throw new Error();
      claims = jwt.verify(header.slice(7), config.jwtSecret, {
        algorithms: ["HS256"],
      });
      objectId(claims.userId);
    } catch {
      throw new ApiError(401, "UNAUTHENTICATED", "Please sign in again");
    }
    const user = await User.findById(claims.userId);
    if (!user)
      throw new ApiError(401, "UNAUTHENTICATED", "Please sign in again");
    req.user = user;
    next();
  });
}
function maintenance(config) {
  return (req, res, next) => {
    const actual = Buffer.from(req.get("Authorization") || ""),
      expected = Buffer.from(`Bearer ${config.maintenanceSecret || ""}`);
    if (
      !config.maintenanceSecret ||
      actual.length !== expected.length ||
      !crypto.timingSafeEqual(actual, expected)
    )
      return next(
        new ApiError(401, "UNAUTHENTICATED", "Invalid maintenance credentials"),
      );
    next();
  };
}
module.exports = { authenticate, maintenance };
