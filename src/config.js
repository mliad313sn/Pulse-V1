"use strict";
// Phase 0 — fail-closed configuration. In production the process REFUSES to
// start without a real SESSION_SECRET; the dev fallback exists only outside
// production so local/test environments stay zero-config.
const IS_PROD = process.env.NODE_ENV === "production";

function sessionSecret() {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (IS_PROD) {
    throw new Error(
      "SESSION_SECRET is required in production (>=16 chars). Refusing to start with a default secret."
    );
  }
  return "dev-only-secret-change-me";
}

module.exports = { sessionSecret, IS_PROD };
