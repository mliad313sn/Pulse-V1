"use strict";
import { api, state, bootstrapSession, loadMeta } from "./lib/api.js";
import { el, esc, toast, showError } from "./lib/ui.js";
import { renderPortfolio } from "./views/portfolio.js";
import { renderProject } from "./views/project.js";
import { renderMeetings, renderMeetingLive } from "./views/meetings.js";
import { renderSiteLens } from "./views/siteLens.js";
import { renderMyActions } from "./views/myActions.js";
import { renderReports } from "./views/reports.js";
import { renderAdmin } from "./views/admin.js";
import { renderWarRoom } from "./views/warRoom.js";
import { renderExecutive } from "./views/executive.js";
import { flush, countQueued, isBlocked, retryAfterReview, discardHead } from "./lib/syncQueue.js";

const app = document.getElementById("app");

// ===== login / password-change screens =====
function renderLogin() {
  app.innerHTML = "";
  app.appendChild(el(`<div class="login-wrap"><form class="login-card">
    <div class="logo">PULSE<span>.</span></div>
    <div class="org">ENDEAVOUR MINING — GROUP IT · IT PROJECT TRACKING</div>
    <label>Email</label><input name="email" type="email" autocomplete="username" required autofocus>
    <label>Password</label><input name="password" type="password" autocomplete="current-password" required>
    <div class="login-error" style="display:none"></div>
    <button class="btn primary" type="submit">Sign in</button>
  </form></div>`));
  app.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const errBox = f.querySelector(".login-error");
    errBox.style.display = "none";
    try {
      const res = await api.post("/api/v1/auth/login", {
        email: f.email.value.trim(), password: f.password.value,
      });
      state.user = res.user;
      state.csrf = res.csrfToken;
      if (res.user.mustChangePassword) {
        renderChangePassword(true);
      } else {
        await loadMeta();
        location.hash = "#/portfolio";
        route();
      }
    } catch (err) {
      errBox.textContent = err.message;
      errBox.style.display = "block";
    }
  };
}

function renderChangePassword(forced = false) {
  app.innerHTML = "";
  app.appendChild(el(`<div class="login-wrap"><form class="login-card">
    <div class="logo">PULSE<span>.</span></div>
    <div class="org">${forced ? "FIRST LOGIN — SET YOUR OWN PASSWORD" : "CHANGE PASSWORD"}</div>
    <label>Current password</label><input name="current" type="password" autocomplete="current-password" required autofocus>
    <label>New password (min 10 characters)</label><input name="next" type="password" autocomplete="new-password" minlength="10" required>
    <label>Repeat new password</label><input name="repeat" type="password" autocomplete="new-password" minlength="10" required>
    <div class="login-error" style="display:none"></div>
    <button class="btn primary" type="submit">Change password</button>
  </form></div>`));
  app.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const errBox = f.querySelector(".login-error");
    errBox.style.display = "none";
    if (f.next.value !== f.repeat.value) {
      errBox.textContent = "New passwords do not match";
      errBox.style.display = "block";
      return;
    }
    try {
      await api.post("/api/v1/auth/change-password", {
        currentPassword: f.current.value, newPassword: f.next.value,
      });
      toast("Password changed");
      state.user.mustChangePassword = false;
      await loadMeta();
      location.hash = "#/portfolio";
      route();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.style.display = "block";
    }
  };
}

// ===== shell =====
let notifTimer = null;

function shell(active, contentNode) {
  const u = state.user;
  const nav = [
    ["portfolio", "▦ Portfolio", "#/portfolio"],
    ["meetings", "▶ Meetings", "#/meetings"],
    ["sites", "◎ Sites", "#/sites"],
    ["my", "☑ My Actions", "#/my"],
    ["warroom", "⚑ War Room", "#/warroom"],
    ["exec", "◆ Executive", "#/exec"],
    ["reports", "📊 Reports", "#/reports"],
  ];
  if (u.role === "ADMIN") nav.push(["admin", "⚙ Admin", "#/admin"]);
  app.innerHTML = "";
  const root = el(`<div class="shell">
    <aside class="sidenav">
      <div class="brand"><div class="logo">PULSE<span>.</span></div>
        <div class="org">ENDEAVOUR MINING — GROUP IT</div></div>
      <nav>${nav.map(([k, label, href]) =>
        `<a class="${k === active ? "active" : ""}" href="${href}">${label}</a>`).join("")}</nav>
      <div class="mock-note">${esc(u.name)} · ${esc(u.role.replace("_", " "))}<br>
        <span class="inline-link" id="nav-pwd">Change password</span> ·
        <span class="inline-link" id="nav-logout">Sign out</span><br>All times GMT</div>
    </aside>
    <div class="main">
      <div class="topbar">
        <div class="search">🔍 <input id="global-q" type="search" placeholder="Search projects & roadblocks…"></div>
        <div id="search-results" class="notif-drop" style="display:none;left:230px;right:auto;top:52px"></div>
        <div class="spacer"></div>
        <span id="sync-chip" class="chip div" style="display:none;cursor:pointer" title="Pulse-V1 offline sync queue"></span>
        <button class="bell" id="bell" title="Notifications">🔔<span class="badge" id="bell-count" style="display:none"></span></button>
        <div id="notif-drop" class="notif-drop" style="display:none"></div>
        <span id="topbar-actions"></span>
      </div>
      <div class="content" id="view"></div>
    </div>
  </div>`);
  app.appendChild(root);
  root.querySelector("#view").appendChild(contentNode);

  root.querySelector("#nav-logout").onclick = async () => {
    await api.post("/api/v1/auth/logout", {});
    state.user = null;
    location.hash = "#/login";
  };
  root.querySelector("#nav-pwd").onclick = () => renderChangePassword(false);

  // notifications bell
  const bell = root.querySelector("#bell");
  const drop = root.querySelector("#notif-drop");
  async function refreshBell() {
    try {
      const res = await api.get("/api/v1/notifications?limit=20");
      const count = root.querySelector("#bell-count");
      if (!count) return;
      count.style.display = res.unreadCount ? "" : "none";
      count.textContent = res.unreadCount;
      drop.dataset.items = JSON.stringify(res.notifications);
    } catch { /* session may have expired */ }
  }
  bell.onclick = async () => {
    if (drop.style.display !== "none") { drop.style.display = "none"; return; }
    const items = JSON.parse(drop.dataset.items || "[]");
    drop.innerHTML = `<div class="notif-head">Notifications
        <span class="spacer" style="flex:1"></span>
        <span class="inline-link" id="read-all" style="font-size:.75rem">Mark all read</span></div>` +
      (items.length ? items.map((n) => `
        <div class="n-item ${n.read_at ? "" : "unread"}" data-id="${n.id}" data-entity="${esc(n.entity)}" data-eid="${n.entity_id}">
          <div><div class="n-type">${esc(n.type.replace(/_/g, " "))}</div>${esc(n.text)}</div>
        </div>`).join("")
        : `<div class="n-item">No notifications yet.</div>`);
    drop.style.display = "";
    drop.querySelector("#read-all").onclick = async () => {
      await api.post("/api/v1/notifications/read-all", {});
      drop.style.display = "none";
      refreshBell();
    };
    drop.querySelectorAll(".n-item[data-id]").forEach((item) => {
      item.onclick = async () => {
        await api.post(`/api/v1/notifications/${item.dataset.id}/read`, {});
        drop.style.display = "none";
        refreshBell();
        const ent = item.dataset.entity;
        if (ent === "project") location.hash = `#/projects/${item.dataset.eid}`;
        else if (ent === "meeting") location.hash = `#/meetings/${item.dataset.eid}`;
        else location.hash = "#/my";
      };
    });
  };
  refreshBell();
  clearInterval(notifTimer);
  notifTimer = setInterval(refreshBell, 60000);

  // Pulse-V1 sync queue status chip
  const chip = root.querySelector("#sync-chip");
  async function refreshSyncChip(detail) {
    const count = detail ? detail.count : await countQueued();
    const blocked = detail ? detail.blocked : !!isBlocked();
    if (blocked) {
      const b = isBlocked() || {};
      chip.style.display = "";
      chip.style.background = "var(--rag-red)";
      chip.style.color = "#fff";
      chip.textContent = `⚠ SYNC HALTED (${count})`;
      chip.title = `Halted on: ${b.summary || "?"} — ${b.status || ""} ${b.error || ""}. Admins alerted. Click to retry or discard the failing change.`;
      chip.onclick = async () => {
        const action = prompt(`Sync is halted on "${b.summary}" (${b.status} ${b.error}).\nType RETRY to replay after admin review, or DISCARD to drop the failing change:`);
        if (action === "RETRY") await retryAfterReview();
        else if (action === "DISCARD") await discardHead();
      };
    } else if (count > 0) {
      chip.style.display = "";
      chip.style.background = "";
      chip.style.color = "";
      chip.textContent = navigator.onLine ? `⇅ syncing ${count}…` : `⇅ ${count} queued offline`;
      chip.title = "Changes waiting in the offline sync queue (FIFO)";
      chip.onclick = () => flush();
    } else {
      chip.style.display = "none";
    }
  }
  window.addEventListener("pulse-sync-change", (e) => refreshSyncChip(e.detail));
  refreshSyncChip();
  flush(); // replay anything queued from a previous offline session

  // global search
  const q = root.querySelector("#global-q");
  const results = root.querySelector("#search-results");
  let searchT = null;
  q.oninput = () => {
    clearTimeout(searchT);
    const term = q.value.trim();
    if (term.length < 2) { results.style.display = "none"; return; }
    searchT = setTimeout(async () => {
      try {
        const res = await api.get(`/api/v1/search?q=${encodeURIComponent(term)}`);
        const rows = [
          ...res.projects.map((p) => `<div class="n-item clickable" data-href="#/projects/${p.id}">
             <div><div class="n-type">PROJECT · ${esc(p.code)}</div>${esc(p.title)}</div></div>`),
          ...res.roadblocks.map((r) => `<div class="n-item clickable" data-href="#/projects/${r.project_id}">
             <div><div class="n-type">ROADBLOCK · ${esc(r.project_code)}</div>${esc(r.title)}</div></div>`),
        ];
        results.innerHTML = rows.length ? rows.join("") : `<div class="n-item">No matches.</div>`;
        results.style.display = "";
        results.querySelectorAll("[data-href]").forEach((r) => {
          r.onclick = () => { results.style.display = "none"; q.value = ""; location.hash = r.dataset.href; };
        });
      } catch { /* noop */ }
    }, 250);
  };
  document.addEventListener("click", (e) => {
    if (!results.contains(e.target) && e.target !== q) results.style.display = "none";
    if (!drop.contains(e.target) && !bell.contains(e.target)) drop.style.display = "none";
  });

  return root.querySelector("#view");
}

// ===== router =====
const routes = [
  [/^#\/portfolio/, "portfolio", renderPortfolio],
  [/^#\/projects\/(\d+)/, "portfolio", renderProject],
  [/^#\/meetings\/(\d+)/, "meetings", renderMeetingLive],
  [/^#\/meetings/, "meetings", renderMeetings],
  [/^#\/sites(?:\/(\w+))?/, "sites", renderSiteLens],
  [/^#\/my/, "my", renderMyActions],
  [/^#\/warroom/, "warroom", renderWarRoom],
  [/^#\/exec/, "exec", renderExecutive],
  [/^#\/reports/, "reports", renderReports],
  [/^#\/admin/, "admin", renderAdmin],
];

export async function route() {
  const hash = location.hash || "#/portfolio";
  if (!state.user) {
    renderLogin();
    return;
  }
  if (state.user.mustChangePassword) {
    renderChangePassword(true);
    return;
  }
  if (hash === "#/login") {
    location.hash = "#/portfolio";
    return;
  }
  for (const [re, navKey, renderer] of routes) {
    const m = hash.match(re);
    if (m) {
      const container = document.createElement("div");
      const view = shell(navKey, container);
      try {
        await renderer(container, ...m.slice(1));
      } catch (err) {
        if (err.status !== 401) {
          container.innerHTML = `<div class="empty-state"><div class="big">⚠</div><b>${esc(err.message)}</b></div>`;
          if (err.status !== 404) showError(err);
        }
      }
      return;
    }
  }
  location.hash = "#/portfolio";
}

window.addEventListener("hashchange", route);

(async () => {
  const ok = await bootstrapSession();
  if (!ok) {
    renderLogin();
    return;
  }
  route();
})();
