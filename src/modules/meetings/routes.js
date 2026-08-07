"use strict";
const express = require("express");
const { z } = require("zod");
const service = require("./service");
const { requireAuth } = require("../../middleware/authz");
const { notFound } = require("../../middleware/errors");

const router = express.Router();
router.use(requireAuth);

const createBody = z.object({
  title: z.string().min(1).max(300),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(["INFRA_OPS_SYNC", "PROJECT_REVIEW", "ADHOC"]),
  site_id: z.number().int().positive().nullable().optional(),
  attendees: z.array(z.number().int().positive()).optional(),
});

router.get("/", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    res.json({ meetings: await service.listMeetings({ limit, offset }) });
  } catch (err) { next(err); }
});

router.post("/", async (req, res, next) => {
  try {
    const meeting = await service.createMeeting(req.user, createBody.parse(req.body));
    res.status(201).json({ meeting });
  } catch (err) { next(err); }
});

router.get("/:id", async (req, res, next) => {
  try {
    res.json(await service.getMeetingDetail(req.user, Number(req.params.id)));
  } catch (err) { next(err); }
});

const itemsBody = z.object({
  ops: z.array(z.object({
    op: z.enum(["add", "remove", "reorder", "note"]),
    id: z.number().int().positive().optional(),
    project_id: z.number().int().positive().nullable().optional(),
    order_index: z.number().int().optional(),
    notes: z.string().max(5000).nullable().optional(),
    reason: z.string().max(200).optional(),
  })),
});
router.put("/:id/items", async (req, res, next) => {
  try {
    await service.updateItems(req.user, Number(req.params.id), itemsBody.parse(req.body).ops);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post("/:id/start", async (req, res, next) => {
  try {
    res.json({ meeting: await service.setStatus(req.user, Number(req.params.id), "LIVE") });
  } catch (err) { next(err); }
});

router.post("/:id/close", async (req, res, next) => {
  try {
    res.json({ meeting: await service.closeMeeting(req.user, Number(req.params.id)) });
  } catch (err) { next(err); }
});

const attendanceBody = z.object({ user_id: z.number().int().positive(), present: z.boolean() });
router.put("/:id/attendance", async (req, res, next) => {
  try {
    const { user_id, present } = attendanceBody.parse(req.body);
    await service.setAttendance(req.user, Number(req.params.id), user_id, present);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

const captureBody = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("action"),
    project_id: z.number().int().positive().nullable().optional(),
    title: z.string().min(1).max(300),
    owner_user_id: z.number().int().positive(),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  }),
  z.object({
    kind: z.literal("decision"),
    project_id: z.number().int().positive(),
    text: z.string().min(1).max(2000),
    decided_by: z.string().max(200).optional(),
  }),
  z.object({
    kind: z.literal("roadblock"),
    project_id: z.number().int().positive(),
    title: z.string().min(1).max(300),
    severity: z.enum(["CRITICAL", "MAJOR", "MINOR"]).optional(),
    owner_user_id: z.number().int().positive().nullable().optional(),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  }),
  z.object({
    kind: z.literal("note"),
    project_id: z.number().int().positive().nullable().optional(),
    text: z.string().min(1).max(5000),
  }),
]);
router.post("/:id/capture", async (req, res, next) => {
  try {
    const created = await service.capture(req.user, Number(req.params.id), captureBody.parse(req.body));
    res.status(201).json({ created });
  } catch (err) { next(err); }
});

// SPM P8 — convert a captured decision into a governed (PENDING) change request
const convertBody = z.object({
  type: z.enum(["SCOPE", "SCHEDULE", "BUDGET", "BENEFIT", "RESOURCE", "CANCELLATION"]),
  title: z.string().min(1).max(300).optional(),
  impact_analysis: z.string().max(5000).nullable().optional(),
  cost_impact: z.number().nullable().optional(),
  schedule_impact_days: z.number().int().nullable().optional(),
});
router.post("/:id/decisions/:decisionId/convert-to-cr", async (req, res, next) => {
  try {
    const cr = await service.convertDecisionToChangeRequest(
      req.user, Number(req.params.id), Number(req.params.decisionId), convertBody.parse(req.body));
    res.status(201).json({ changeRequest: cr });
  } catch (err) { next(err); }
});

// Minutes: structured JSON (latest, or ?version=n for a historical snapshot)
router.get("/:id/minutes", async (req, res, next) => {
  try {
    const v = await service.getMinutesVersion(Number(req.params.id), Number(req.query.version) || null);
    if (!v) throw notFound("Minutes not generated yet — close the meeting first");
    res.json({ minutes: v.minutes_json, version: v.version });
  } catch (err) { next(err); }
});

// Version index (who closed which version, when)
router.get("/:id/minutes/versions", async (req, res, next) => {
  try {
    res.json({ versions: await service.listMinutesVersions(Number(req.params.id)) });
  } catch (err) { next(err); }
});

// Minutes: server-rendered HTML, fully escaped (XSS-inert by construction)
router.get("/:id/minutes.html", async (req, res, next) => {
  try {
    const v = await service.getMinutesVersion(Number(req.params.id), Number(req.query.version) || null);
    if (!v) throw notFound("Minutes not generated yet — close the meeting first");
    res.type("html").send(service.renderMinutesHtml(v.minutes_json));
  } catch (err) { next(err); }
});

module.exports = router;
