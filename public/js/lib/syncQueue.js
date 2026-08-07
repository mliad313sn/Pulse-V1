"use strict";
// Pulse-V1 SyncQueueManager — basic offline transaction queue.
// Mutating API calls that fail because the network is down are stored in
// IndexedDB as a sequential log and replayed strictly FIFO when connectivity
// returns. A server error during replay (4xx/5xx, e.g. a hard collision) HALTS
// the queue and alerts the administrators — no automated conflict resolution.
import { state } from "./api.js";

const DB_NAME = "pulse-sync";
const STORE = "queue";
const BLOCKED_KEY = "pulse-sync-blocked";

let dbPromise = null;
let flushing = false;

function db() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "seq", autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const out = fn(store);
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
  }));
}

function emit() {
  Promise.all([countQueued(), Promise.resolve(isBlocked())]).then(([count, blocked]) =>
    window.dispatchEvent(new CustomEvent("pulse-sync-change", { detail: { count, blocked: !!blocked } }))
  );
}

export function isBlocked() {
  const raw = localStorage.getItem(BLOCKED_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function countQueued() {
  return tx("readonly", (s) => s.count());
}

export async function enqueueOp({ method, url, body, summary }) {
  const op = {
    op_id: crypto.randomUUID(),
    method, url, body: body ?? null,
    summary: summary || `${method} ${url}`,
    queued_at: new Date().toISOString(),
  };
  await tx("readwrite", (s) => s.add(op));
  emit();
  return op;
}

async function oldest() {
  return tx("readonly", (s) => new Promise((res) => {
    const c = s.openCursor();
    c.onsuccess = () => res(c.result ? { seq: c.result.key, ...c.result.value } : null);
  }));
}

async function remove(seq) {
  await tx("readwrite", (s) => s.delete(seq));
}

async function alertAdmins(op, status, errorText, remaining) {
  try {
    await fetch("/api/v1/sync/halt-alert", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": state.csrf },
      body: JSON.stringify({
        op_summary: op.summary.slice(0, 300), status,
        error: String(errorText).slice(0, 500), queued_remaining: remaining,
      }),
    });
  } catch { /* offline again — the halt state itself persists */ }
}

// Strictly linear FIFO replay. Stops on network loss (resumes later) or HALTS on
// any server error.
export async function flush() {
  if (flushing || isBlocked() || !navigator.onLine || !state.csrf) return;
  flushing = true;
  try {
    for (;;) {
      const op = await oldest();
      if (!op) break;
      let res;
      try {
        res = await fetch(op.url, {
          method: op.method, credentials: "same-origin",
          headers: {
            ...(op.body !== null ? { "Content-Type": "application/json" } : {}),
            "X-CSRF-Token": state.csrf,
            "X-Client-Op-Id": op.op_id,
          },
          body: op.body !== null ? JSON.stringify(op.body) : undefined,
        });
      } catch {
        break; // network gone again — keep the queue intact, retry on next 'online'
      }
      if (res.ok) {
        await remove(op.seq); // applied (or server-side duplicate) — dequeue
        emit();
        continue;
      }
      // hard server error: HALT, keep the op, alert admins, no auto-resolution
      let detail = "";
      try { detail = (await res.json()).error || ""; } catch { /* keep empty */ }
      const remaining = await countQueued();
      localStorage.setItem(BLOCKED_KEY, JSON.stringify({
        at: new Date().toISOString(), status: res.status, error: detail, summary: op.summary,
      }));
      await alertAdmins(op, res.status, detail, remaining);
      emit();
      break;
    }
  } finally {
    flushing = false;
    emit();
  }
}

// manual controls (used from the shell banner after an administrator intervenes)
export async function retryAfterReview() {
  localStorage.removeItem(BLOCKED_KEY);
  emit();
  return flush();
}

export async function discardHead() {
  const op = await oldest();
  if (op) await remove(op.seq);
  localStorage.removeItem(BLOCKED_KEY);
  emit();
  return flush();
}

window.addEventListener("online", () => flush());
