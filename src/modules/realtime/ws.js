"use strict";
// E15 — realtime meeting presenter sync (plan §38).
// The socket carries POINTERS only (view context like "#/projects/7") — never
// record data. Followers fetch content through normal authorized REST, so the
// realtime transport cannot bypass authorization, confidentiality or site
// isolation. The upgrade handshake itself requires a valid signed session
// cookie backed by a live session row and an active user.
const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const { query } = require("../../db/pool");

const SECRET = () => process.env.SESSION_SECRET || "dev-only-secret-change-me";

// express-session cookie: pulse.sid=s%3A<sid>.<hmac-sha256-base64-no-pad>
function sidFromCookieHeader(header) {
  if (!header) return null;
  const m = /(?:^|;\s*)pulse\.sid=([^;]+)/.exec(header);
  if (!m) return null;
  const raw = decodeURIComponent(m[1]);
  if (!raw.startsWith("s:")) return null;
  const dot = raw.lastIndexOf(".");
  if (dot < 0) return null;
  const sid = raw.slice(2, dot);
  const sig = raw.slice(dot + 1);
  const expected = crypto.createHmac("sha256", SECRET()).update(sid).digest("base64").replace(/=+$/, "");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return sid;
}

async function userFromRequest(req) {
  const sid = sidFromCookieHeader(req.headers.cookie);
  if (!sid) return null;
  const { rows: sess } = await query(
    `SELECT sess FROM session WHERE sid = $1 AND expire > now()`, [sid]);
  const userId = sess[0]?.sess?.userId;
  if (!userId) return null;
  const { rows } = await query(
    `SELECT id, name, role, is_steering_committee FROM users
      WHERE id = $1 AND deleted_at IS NULL AND active = true AND must_change_password = false`,
    [userId]);
  return rows[0] || null;
}

// rooms: meetingId -> { presenterId, presenterName, context, clients:Set<ws> }
const rooms = new Map();

function room(meetingId) {
  if (!rooms.has(meetingId)) {
    rooms.set(meetingId, { presenterId: null, presenterName: null, context: null, clients: new Set() });
  }
  return rooms.get(meetingId);
}

function broadcast(r, msg, except = null) {
  const data = JSON.stringify(msg);
  for (const c of r.clients) if (c !== except && c.readyState === 1) c.send(data);
}

function roomState(r) {
  return {
    type: "room",
    presenterId: r.presenterId, presenterName: r.presenterName,
    context: r.context, followers: r.clients.size,
  };
}

function attach(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    if (!req.url.startsWith("/ws/meetings")) { socket.destroy(); return; }
    userFromRequest(req)
      .then((user) => {
        if (!user) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          ws.user = user;
          wss.emit("connection", ws, req);
        });
      })
      .catch(() => socket.destroy());
  });

  wss.on("connection", (ws) => {
    ws.on("message", async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      if (msg.type === "join") {
        const meetingId = Number(msg.meetingId);
        if (!Number.isInteger(meetingId) || meetingId <= 0) return;
        const { rows } = await query(
          `SELECT id, status FROM meetings WHERE id = $1 AND deleted_at IS NULL`, [meetingId]);
        if (!rows.length) { ws.send(JSON.stringify({ type: "error", error: "Meeting not found" })); return; }
        if (ws.meetingId) room(ws.meetingId).clients.delete(ws);
        ws.meetingId = meetingId;
        const r = room(meetingId);
        r.clients.add(ws);
        ws.send(JSON.stringify(roomState(r))); // late joiners get the live context
        broadcast(r, { type: "followers", followers: r.clients.size }, ws);
        return;
      }

      const r = ws.meetingId ? room(ws.meetingId) : null;
      if (!r) return;

      if (msg.type === "present") {
        // Viewers never drive the room; others may claim a free chair;
        // Admin/Steering can take over a stale presenter.
        if (ws.user.role === "VIEWER") {
          ws.send(JSON.stringify({ type: "error", error: "Viewers cannot present" }));
          return;
        }
        const takeover = ws.user.role === "ADMIN" || ws.user.is_steering_committee === true;
        if (r.presenterId && r.presenterId !== ws.user.id && !takeover) {
          ws.send(JSON.stringify({ type: "error", error: `${r.presenterName} is presenting` }));
          return;
        }
        r.presenterId = ws.user.id;
        r.presenterName = ws.user.name;
        broadcast(r, { type: "presenter", presenterId: r.presenterId, presenterName: r.presenterName });
        return;
      }

      if (msg.type === "release") {
        if (r.presenterId !== ws.user.id) return;
        r.presenterId = null; r.presenterName = null;
        broadcast(r, { type: "presenter", presenterId: null, presenterName: null });
        return;
      }

      if (msg.type === "pivot") {
        if (r.presenterId !== ws.user.id) {
          ws.send(JSON.stringify({ type: "error", error: "Only the presenter pivots the room" }));
          return;
        }
        // context is an opaque view pointer (e.g. "#/projects/7") — max 500 chars
        const context = String(msg.context || "").slice(0, 500);
        r.context = context;
        broadcast(r, { type: "context", context }, ws);
        return;
      }
    });

    ws.on("close", () => {
      if (!ws.meetingId) return;
      const r = room(ws.meetingId);
      r.clients.delete(ws);
      if (r.presenterId === ws.user.id) {
        r.presenterId = null; r.presenterName = null;
        broadcast(r, { type: "presenter", presenterId: null, presenterName: null });
      }
      broadcast(r, { type: "followers", followers: r.clients.size });
      if (!r.clients.size) rooms.delete(ws.meetingId);
    });
  });

  return wss;
}

module.exports = { attach };
