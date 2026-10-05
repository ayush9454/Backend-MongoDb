class ApiError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}
const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  let status = err.status || 500;
  let code = err.code || "INTERNAL_ERROR";
  let message = err.message;
  if (
    err.name === "ValidationError" ||
    err.name === "CastError" ||
    err.type === "entity.parse.failed"
  ) {
    status = 400;
    code = "INVALID_INPUT";
    message = "Invalid request data";
  }
  if (err.code === 11000) {
    status = 409;
    code = "CONFLICT";
    message = "A record already exists";
  }
  if (status >= 500) {
    console.error(
      JSON.stringify({
        level: "error",
        requestId: req.id,
        message: err.message,
      }),
    );
    code = "INTERNAL_ERROR";
    message = "The request could not be completed";
  }
  res.status(status).json({
    error: { code, message, ...(err.fields ? { fields: err.fields } : {}) },
  });
}
module.exports = { ApiError, asyncRoute, errorHandler };
