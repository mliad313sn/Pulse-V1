"use strict";
// E15 — presenter sync over WebSocket: authenticated upgrade only, presenter
// authority, pointer broadcast, late-join replay, reconnection, and the rule
// that the transport carries pointers (never record data).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const WebSocket = require("ws");
const { initDb, fixtures, login, closePool, createApp } = require("../helpers");
const { attach } = require("../../src/modules/realtime/ws");

let app, F, server, port, meeting;
let admin, infLead, viewer;

function cookieOf(session) {
  // supertest agent stores cookies internally; grab from the jar
  const jar = session.agent.jar;
  return jar.getCookies({ domain: "127.0.0.1", path: "/", secure: false, script: false })
    .toValueString();
}

function wsFor(session) {
  return new WebSocket(`ws://127.0.0.1:${port}/ws/meetings`, {
    headers: { Cookie: cookieOf(session) },
  });
}

const nextMsg = (ws, wanted) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`timeout waiting for ${wanted}`)), 4000);
  const onMsg = (raw) => {
    const m = JSON.parse(raw);
    if (!wanted || m.type === wanted) { clearTimeout(t); ws.off("message", onMsg); resolve(m); }
  };
  ws.on("message", onMsg);
});

const opened = (ws) => new Promise((resolve, reject) => {
  ws.on("open", resolve);
  ws.on("unexpected-response", (_, res) => reject(new Error(`upgrade rejected: ${res.statusCode}`)));
  ws.on("error", reject);
});

before(async () => {
  await initDb();
  F = await fixtures();
  app = createApp();
  server = http.createServer(app);
  attach(server);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
  [admin, infLead, viewer] = await Promise.all([
    login(app, "admin@test.local"), login(app, "inf@test.local"), login(app, "viewer@test.local"),
  ]);
  meeting = (await infLead.post("/api/v1/meetings").send({
    title: "Weekly infra sync", date: "2026-08-10", type: "INFRA_OPS_SYNC",
  })).body.meeting;
});
after(async () => {
  server.close();
  await closePool();
});

test("E15 authorization: upgrade without a valid session is rejected with 401", async () => {
  const bare = new WebSocket(`ws://127.0.0.1:${port}/ws/meetings`);
  await assert.rejects(opened(bare), /upgrade rejected: 401/);
  const forged = new WebSocket(`ws://127.0.0.1:${port}/ws/meetings`, {
    headers: { Cookie: "pulse.sid=s%3Aforged.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
  });
  await assert.rejects(opened(forged), /upgrade rejected: 401/);
});

test("E15 room flow: presenter claims, pivots reach followers; viewer cannot drive; late joiner replays", async () => {
  const presenter = wsFor(infLead);
  const follower = wsFor(viewer);
  await Promise.all([opened(presenter), opened(follower)]);

  presenter.send(JSON.stringify({ type: "join", meetingId: meeting.id }));
  await nextMsg(presenter, "room");
  follower.send(JSON.stringify({ type: "join", meetingId: meeting.id }));
  await nextMsg(follower, "room");

  // viewer cannot claim the room
  follower.send(JSON.stringify({ type: "present" }));
  const deny = await nextMsg(follower, "error");
  assert.match(deny.error, /Only the organizer, Admin or Steering/);

  // non-presenter pivot refused
  follower.send(JSON.stringify({ type: "pivot", context: "item:5" }));
  const deny2 = await nextMsg(follower, "error");
  assert.match(deny2.error, /Only the presenter/);

  // presenter claims and pivots — follower receives the pointer
  presenter.send(JSON.stringify({ type: "present" }));
  await nextMsg(follower, "presenter");
  const got = nextMsg(follower, "context");
  presenter.send(JSON.stringify({ type: "pivot", context: "item:2" }));
  assert.equal((await got).context, "item:2");

  // late joiner (admin) replays the live context from the join response
  const late = wsFor(admin);
  await opened(late);
  late.send(JSON.stringify({ type: "join", meetingId: meeting.id }));
  const room = await nextMsg(late, "room");
  assert.equal(room.context, "item:2");
  assert.equal(room.presenterName, "Inf Lead");

  // presenter disconnect frees the chair for everyone else
  const freed = nextMsg(follower, "presenter");
  presenter.close();
  assert.equal((await freed).presenterId, null);

  // reconnection: follower drops and rejoins, replaying live state (§38)
  follower.close();
  const back = wsFor(viewer);
  await opened(back);
  back.send(JSON.stringify({ type: "join", meetingId: meeting.id }));
  const replay = await nextMsg(back, "room");
  assert.equal(replay.context, "item:2");
  back.close();
  late.close();
});

test("E15 unknown meeting: join is refused without leaking existence details", async () => {
  const ws = wsFor(viewer);
  await opened(ws);
  ws.send(JSON.stringify({ type: "join", meetingId: 999999 }));
  const err = await nextMsg(ws, "error");
  assert.equal(err.error, "Meeting not found");
  ws.close();
});
