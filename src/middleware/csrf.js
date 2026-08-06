"use strict";
// Double-submit CSRF (plan §1): a random token is minted at login and stored in the
// session; every mutating request must echo it in the X-CSRF-Token header.
const crypto = require("crypto");
const { forbidden } = require("./errors");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
// login/logout are exempt: login mints the token, logout destroys the session.
const EXEMPT_PATHS = new Set(["/api/v1/auth/login", "/api/v1/auth/logout"]);

function issueToken(session) {
  session.csrfToken = crypto.randomBytes(32).toString("hex");
  return session.csrfToken;
}

function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method) || EXEMPT_PATHS.has(req.path)) return next();
  const header = req.get("X-CSRF-Token");
  if (!req.session || !req.session.csrfToken || header !== req.session.csrfToken) {
    return next(forbidden("Invalid or missing CSRF token"));
  }
  return next();
}

module.exports = { issueToken, csrfProtection };
