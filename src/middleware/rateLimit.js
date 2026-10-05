const { ApiError } = require("./errors");
// Per-process demo limiter. Multi-instance deployments should enforce these limits at the gateway too.
function rateLimit({
  limit = 20,
  windowMs = 15 * 60 * 1000,
  maxEntries = 10000,
} = {}) {
  const entries = new Map();
  return (req, res, next) => {
    const now = Date.now(),
      key = req.ip;
    if (entries.size >= maxEntries)
      for (const [ip, value] of entries)
        if (value.until <= now) entries.delete(ip);
    let entry = entries.get(key);
    if (!entry || entry.until <= now) {
      if (entries.size >= maxEntries)
        return next(
          new ApiError(429, "RATE_LIMITED", "Please try again later"),
        );
      entry = { count: 0, until: now + windowMs };
      entries.set(key, entry);
    }
    entry.count++;
    if (entry.count > limit) {
      res.set("Retry-After", String(Math.ceil((entry.until - now) / 1000)));
      return next(
        new ApiError(
          429,
          "RATE_LIMITED",
          "Too many requests; please try again later",
        ),
      );
    }
    next();
  };
}
module.exports = rateLimit;
