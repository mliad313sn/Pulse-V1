"use strict";
const { ZodError } = require("zod");

class ApiError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const badRequest = (msg, extra) => new ApiError(400, msg, extra);
const unauthorized = (msg = "Authentication required") => new ApiError(401, msg);
const forbidden = (msg = "Not allowed") => new ApiError(403, msg);
const notFound = (msg = "Not found") => new ApiError(404, msg);
const conflict = (msg, extra) => new ApiError(409, msg, extra);

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "Validation failed",
      details: err.errors.map((e) => ({ path: e.path.join("."), message: e.message })),
    });
  }
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  }
  // SPM P12 — an unexpected failure is logged as one structured line carrying
  // the request id, and the client is given that same id. The user can quote
  // it in a ticket; the log never returns the stack to the browser.
  const requestId = req.id || null;
  try {
    require("./observability").log("error", {
      msg: "unhandled_error", request_id: requestId,
      method: req.method, path: req.originalUrl?.split("?")[0],
      user_id: req.session?.userId || null,
      error: err.message, stack: err.stack,
    });
  } catch {
    console.error("Unhandled error:", err);
  }
  return res.status(500).json({ error: "Internal server error", request_id: requestId });
}

module.exports = { ApiError, badRequest, unauthorized, forbidden, notFound, conflict, errorHandler };
