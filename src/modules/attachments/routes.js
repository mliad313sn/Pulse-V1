"use strict";
const express = require("express");
const busboy = require("busboy");
const service = require("./service");
const { requireAuth, withProjectAccess, loadProjectAccess } = require("../../middleware/authz");
const { badRequest } = require("../../middleware/errors");

const router = express.Router();
router.use(requireAuth);

// Multipart parse with a hard size cap enforced during streaming.
function parseUpload(req) {
  return new Promise((resolve, reject) => {
    const bb = busboy({ headers: req.headers, limits: { fileSize: service.MAX_BYTES, files: 1 } });
    const fields = {};
    let file = null;
    bb.on("field", (name, val) => { fields[name] = val; });
    bb.on("file", (name, stream, info) => {
      const chunks = [];
      let truncated = false;
      stream.on("data", (c) => chunks.push(c));
      stream.on("limit", () => { truncated = true; });
      stream.on("end", () => {
        if (truncated) return reject(badRequest("File exceeds the 25 MB limit"));
        file = { filename: info.filename, buffer: Buffer.concat(chunks) };
      });
    });
    bb.on("error", reject);
    bb.on("finish", () => {
      if (!file) return reject(badRequest("A file part is required"));
      resolve({ file, fields });
    });
    req.pipe(bb);
  });
}

router.get("/projects/:projectId/attachments", withProjectAccess(), async (req, res, next) => {
  try {
    res.json({ attachments: await service.list(req.projectAccess, req.query.entity, req.query.entityId) });
  } catch (err) { next(err); }
});

router.post("/projects/:projectId/attachments", withProjectAccess(), async (req, res, next) => {
  try {
    const { file, fields } = await parseUpload(req);
    const att = await service.create(req.user, req.projectAccess, file, fields);
    res.status(201).json({ attachment: att });
  } catch (err) { next(err); }
});

// Download: resolve the row, then run FULL project visibility (concealment).
router.get("/attachments/:id", async (req, res, next) => {
  try {
    const row = await service.load(Number(req.params.id));
    const pa = await loadProjectAccess(row.project_id, req.user); // throws concealed 404
    // classification enforcement mirrors the list: CONFIDENTIAL = FULL only,
    // concealed as 404 so its existence is not confirmed
    if (row.classification === "CONFIDENTIAL" && pa.access !== "FULL") {
      const { notFound } = require("../../middleware/errors");
      throw notFound("Attachment not found");
    }
    const buf = await service.content(row);
    res.setHeader("Content-Type", row.media_type);
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Content-Disposition",
      `attachment; filename="${row.filename.replace(/"/g, "")}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(buf);
  } catch (err) { next(err); }
});

router.delete("/attachments/:id", async (req, res, next) => {
  try {
    const row = await service.load(Number(req.params.id));
    const pa = await loadProjectAccess(row.project_id, req.user);
    await service.softDelete(req.user, pa, row.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
