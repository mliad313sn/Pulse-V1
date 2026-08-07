"use strict";
// E24 — storage abstraction (plan §51 "S3-compatible storage abstraction").
// Adapter contract: put(key, buffer) / get(key) -> buffer / remove(key).
// Local disk adapter is the dev/pilot implementation. An S3-compatible
// adapter implements the same contract against a bucket (endpoint + creds
// via env) — recorded as BLOCKED_EXTERNAL until real object storage and
// credentials exist; nothing else in the module changes when it lands.
const fs = require("fs");
const path = require("path");

function localAdapter(root) {
  fs.mkdirSync(root, { recursive: true });
  // keys are server-generated hex — reject anything else (key isolation)
  const safe = (key) => {
    if (!/^[a-f0-9]{32,64}$/.test(key)) throw new Error("invalid storage key");
    return path.join(root, key.slice(0, 2), key);
  };
  return {
    async put(key, buffer) {
      const p = safe(key);
      await fs.promises.mkdir(path.dirname(p), { recursive: true });
      await fs.promises.writeFile(p, buffer);
    },
    async get(key) {
      return fs.promises.readFile(safe(key));
    },
    async remove(key) {
      await fs.promises.unlink(safe(key)).catch(() => {});
    },
  };
}

let instance = null;
function storage() {
  if (!instance) {
    const root = process.env.ATTACHMENTS_DIR || path.join(process.cwd(), "data", "attachments");
    instance = localAdapter(root);
  }
  return instance;
}

module.exports = { storage, localAdapter };
