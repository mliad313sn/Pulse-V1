"use strict";
// E15 — presenter-sync client. Carries view POINTERS only; all data is
// fetched through normal authorized REST by each participant's own session.
// Reconnects with backoff and re-joins the room (server replays live context).

let ws = null;
let currentMeeting = null;
let handlers = {};
let retry = 1000;
let closedByUs = false;

function open() {
  const url = `${location.origin.replace(/^http/, "ws")}/ws/meetings`;
  ws = new WebSocket(url);
  ws.onopen = () => {
    retry = 1000;
    ws.send(JSON.stringify({ type: "join", meetingId: currentMeeting }));
    handlers.onStatus?.("connected");
  };
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === "room") handlers.onRoom?.(msg);
    else if (msg.type === "context") handlers.onContext?.(msg.context);
    else if (msg.type === "presenter") handlers.onPresenter?.(msg);
    else if (msg.type === "followers") handlers.onFollowers?.(msg.followers);
    else if (msg.type === "error") handlers.onError?.(msg.error);
  };
  ws.onclose = () => {
    handlers.onStatus?.("disconnected");
    if (closedByUs) return;
    setTimeout(() => { if (!closedByUs && currentMeeting) open(); }, retry);
    retry = Math.min(retry * 2, 10000); // reconnection (§38)
  };
  ws.onerror = () => ws.close();
}

export function connectPresenter(meetingId, h) {
  if (ws && currentMeeting === meetingId) { handlers = h; return api; }
  disconnectPresenter();
  currentMeeting = meetingId;
  handlers = h;
  closedByUs = false;
  open();
  return api;
}

export function disconnectPresenter() {
  closedByUs = true;
  currentMeeting = null;
  if (ws && ws.readyState <= 1) ws.close();
  ws = null;
}

const send = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
const api = {
  present: () => send({ type: "present" }),
  release: () => send({ type: "release" }),
  pivot: (context) => send({ type: "pivot", context }),
};
export const presenterApi = api;
