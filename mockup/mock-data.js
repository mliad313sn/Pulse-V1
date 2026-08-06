/* PULSE P1 mock — fake data + tiny shared helpers. No backend; everything in-memory. */

const TODAY = new Date("2026-08-06T00:00:00Z"); // frozen "today" (GMT) so the mock is deterministic

const DIVISIONS = {
  INF: "Infrastructure", OPS: "Operations", BAP: "Business Apps", DAT: "Data Insight",
  SEC: "Information Security", EAR: "Enterprise Architecture", GRP: "Group IT",
};

const SITES = ["SGO", "HGO", "ITY", "SML", "MGO", "KGO", "DKR", "ABJ", "OUA", "GROUP"];

// Each project: computed rag + 4 signals (per plan §3), computed progress, denormalized card fields.
const PROJECTS = [
  {
    code: "PRJ-2026-001", title: "SGO LAN Refresh", lead: "INF", engaged: ["OPS", "SEC"],
    sites: ["SGO"], stage: "BUILD", priority: "P1", rag: "R",
    signals: { schedule: "R", roadblocks: "R", actions: "A", freshness: "G" },
    progress: 45, daysToTarget: 39, target: "14 Sep 26",
    topRoadblock: "Core switch stuck in Abidjan customs (CRITICAL)",
    nextMilestone: "Core switch staging", nextMilestoneDate: "12 Aug 26",
    pm: { name: "Awa Diallo", initials: "AD", role: "Contributor — Site IT Lead SGO" },
    override: null, confidential: false, silent: false,
  },
  {
    code: "PRJ-2026-002", title: "Group ERP Upgrade R2", lead: "BAP", engaged: ["INF", "OPS", "DAT"],
    sites: ["GROUP", "SGO", "HGO", "ITY", "SML", "MGO", "KGO"], stage: "DESIGN", priority: "P1", rag: "A",
    signals: { schedule: "A", roadblocks: "G", actions: "A", freshness: "G" },
    progress: 20, daysToTarget: 176, target: "29 Jan 27",
    topRoadblock: "Vendor SoW pending legal review (MAJOR)",
    nextMilestone: "Solution design sign-off", nextMilestoneDate: "28 Aug 26",
    pm: { name: "Kofi Mensah", initials: "KM", role: "Division Lead — Business Apps" },
    override: null, confidential: false, silent: false,
  },
  {
    code: "PRJ-2026-003", title: "HGO Backup WAN Link", lead: "INF", engaged: ["OPS"],
    sites: ["HGO"], stage: "DEPLOY", priority: "P2", rag: "G",
    signals: { schedule: "G", roadblocks: "G", actions: "G", freshness: "G" },
    progress: 83, daysToTarget: 14, target: "20 Aug 26",
    topRoadblock: null,
    nextMilestone: "GO_LIVE — failover test", nextMilestoneDate: "18 Aug 26",
    pm: { name: "Ibrahim Traoré", initials: "IT", role: "Contributor — Site IT Lead HGO" },
    override: null, confidential: false, silent: false, goLiveSoon: true,
  },
  {
    code: "PRJ-2026-004", title: "SOC Onboarding Wave 2", lead: "SEC", engaged: ["INF", "OPS"],
    sites: ["ITY", "SML"], stage: "BUILD", priority: "P1", rag: "A",
    signals: { schedule: "G", roadblocks: "A", actions: "G", freshness: "A" },
    progress: 60, daysToTarget: 55, target: "30 Sep 26",
    topRoadblock: "Log forwarder sizing at SML (MAJOR)",
    nextMilestone: "SECURITY_GATE — SML sensors", nextMilestoneDate: "05 Sep 26",
    pm: { name: "Fatou Ndiaye", initials: "FN", role: "Division Lead — InfoSec" },
    override: null, confidential: false, silent: false,
  },
  {
    code: "PRJ-2026-005", title: "BI Datalake Phase 2", lead: "DAT", engaged: ["BAP"],
    sites: ["GROUP"], stage: "BUILD", priority: "P2", rag: "G",
    signals: { schedule: "G", roadblocks: "G", actions: "G", freshness: "G" },
    progress: 55, daysToTarget: 86, target: "31 Oct 26",
    topRoadblock: null,
    nextMilestone: "Ingestion pipeline UAT", nextMilestoneDate: "21 Aug 26",
    pm: { name: "Marie Kouassi", initials: "MK", role: "Contributor — Data Engineer" },
    override: null, confidential: false, silent: false,
  },
  {
    code: "PRJ-2026-006", title: "ITY Camp Wi-Fi Extension", lead: "OPS", engaged: ["INF"],
    sites: ["ITY"], stage: "BUILD", priority: "P3", rag: "R",
    signals: { schedule: "G", roadblocks: "G", actions: "G", freshness: "R" },
    progress: 30, daysToTarget: 25, target: "31 Aug 26",
    topRoadblock: null,
    nextMilestone: "AP mounting — camp block C", nextMilestoneDate: "10 Aug 26",
    pm: { name: "Sekou Camara", initials: "SC", role: "Contributor — Site IT Lead ITY" },
    override: null, confidential: false, silent: true, // no activity of any kind > 30 days
  },
  {
    code: "PRJ-2026-007", title: "MGO ERP Site Rollout", lead: "BAP", engaged: ["OPS"],
    sites: ["MGO"], stage: "DEPLOY", priority: "P1", rag: "A",
    signals: { schedule: "A", roadblocks: "G", actions: "A", freshness: "G" },
    progress: 71, daysToTarget: 20, target: "26 Aug 26",
    topRoadblock: "Training room availability (MINOR)",
    nextMilestone: "SITE_READINESS — MGO cutover", nextMilestoneDate: "19 Aug 26",
    pm: { name: "Aminata Sow", initials: "AS", role: "Contributor — Site IT Lead MGO" },
    override: null, confidential: false, silent: false,
  },
  {
    code: "PRJ-2026-008", title: "EA Reference Architecture", lead: "EAR", engaged: ["GRP"],
    sites: ["GROUP"], stage: "ON_HOLD", priority: "P3", rag: "G",
    signals: { schedule: "G", roadblocks: "G", actions: "G", freshness: "EXEMPT" },
    progress: 40, daysToTarget: null, target: "TBC",
    topRoadblock: null,
    nextMilestone: "Paused — restart decision Q4", nextMilestoneDate: "—",
    pm: { name: "Jean-Luc Koffi", initials: "JK", role: "Division Lead — EA" },
    override: null, confidential: false, silent: false,
  },
  {
    code: "PRJ-2026-009", title: "KGO Site IT Build-out", lead: "INF", engaged: ["OPS", "SEC"],
    sites: ["KGO"], stage: "BUILD", priority: "P1", rag: "A",
    signals: { schedule: "G", roadblocks: "G", actions: "G", freshness: "G" },
    progress: 35, daysToTarget: 116, target: "30 Nov 26",
    topRoadblock: "Rack delivery lead time (MINOR)",
    nextMilestone: "SITE_READINESS — server room", nextMilestoneDate: "01 Sep 26",
    pm: { name: "Moussa Ouédraogo", initials: "MO", role: "Contributor — Site IT Lead KGO" },
    override: { rag: "A", reason: "Rack delivery re-baselined with vendor on 02 Aug; schedule risk contained pending week-33 confirmation." },
    confidential: false, silent: false,
  },
  {
    code: "PRJ-2026-010", title: "Executive Cost Dashboard", lead: "DAT", engaged: ["GRP"],
    sites: ["GROUP", "DKR"], stage: "DESIGN", priority: "P2", rag: "G",
    signals: { schedule: "G", roadblocks: "G", actions: "G", freshness: "G" },
    progress: 10, daysToTarget: 146, target: "30 Dec 26",
    topRoadblock: null,
    nextMilestone: "KPI catalogue agreed", nextMilestoneDate: "01 Sep 26",
    pm: { name: "Group IT Manager", initials: "GM", role: "Admin" },
    override: null, confidential: true, silent: false,
  },
];

const SIGNAL_LABELS = {
  schedule: "Schedule (slipped/overdue milestones)",
  roadblocks: "Roadblocks (open severity)",
  actions: "Actions (overdue count)",
  freshness: "Freshness (activity/updates)",
};

/* ---------- shared render helpers ---------- */

function ragTip(p) {
  const rows = Object.entries(p.signals).map(([k, v]) => {
    const val = v === "EXEMPT"
      ? '<span style="opacity:.7">exempt (ON_HOLD)</span>'
      : `<span class="sig ${v}"></span>${v === "G" ? "Green" : v === "A" ? "Amber" : "Red"}`;
    return `<div class="trow"><b>${SIGNAL_LABELS[k].split(" (")[0]}</b><span>${val}</span></div>`;
  }).join("");
  const overall = `<div class="trow" style="border-top:1px solid rgba(255,255,255,.25);margin-top:5px;padding-top:5px">
      <b>Overall = worst of 4</b><span>${p.rag === "G" ? "Green" : p.rag === "A" ? "Amber" : "Red"}</span></div>`;
  const ovr = p.override
    ? `<div class="trow" style="margin-top:4px"><span style="opacity:.85">Manual override by PM/Lead:<br>“${p.override.reason}”</span></div>` : "";
  return `<div class="tip">${rows}${overall}${ovr}</div>`;
}

function ragDot(p, extra = "") {
  const effective = p.override ? p.override.rag : p.rag;
  return `<span class="rag-dot ${effective} ${extra}">${ragTip(p)}</span>
    ${p.override ? '<span class="manual-badge" title="' + p.override.reason.replace(/"/g, "&quot;") + '">MANUAL</span>' : ""}`;
}

function projectCard(p) {
  const stageChip = `<span class="chip stage ${p.stage === "ON_HOLD" ? "HOLD" : ""}">${p.stage.replace("_", " ")}</span>`;
  const divChips = [`<span class="chip div lead">${p.lead}</span>`]
    .concat(p.engaged.map(d => `<span class="chip div">${d}</span>`)).join("");
  const siteChips = p.sites.map(s => `<span class="chip site">${s}</span>`).join("");
  const conf = p.confidential ? `<span class="chip conf">CONFIDENTIAL</span>` : "";
  const rb = p.topRoadblock
    ? `<span class="warn">⚑ ${p.topRoadblock}</span>`
    : `<span style="color:var(--rag-green)">✓ No open roadblocks</span>`;
  const days = p.daysToTarget == null ? "—"
    : p.daysToTarget < 0 ? `<span class="warn">${-p.daysToTarget}d past target</span>`
    : `${p.daysToTarget}d to target`;
  return `
  <a class="pcard" href="project.html" data-code="${p.code}">
    <div class="row1">
      ${ragDot(p)}
      <span class="code">${p.code}</span>
      <span style="margin-left:auto" class="chip prio">${p.priority}</span>
    </div>
    <div class="title">${p.title}</div>
    <div class="chips">${stageChip}${divChips}${siteChips}${conf}</div>
    <div class="pline">
      <div class="progress"><i style="width:${p.progress}%"></i></div>
      <span>${p.progress}% <span style="color:var(--ink-faint)">(milestones done)</span></span>
    </div>
    <div class="meta">
      ${rb}
      <span>◈ Next: ${p.nextMilestone} — <b>${p.nextMilestoneDate}</b></span>
    </div>
    <div class="foot">
      <span class="pm-cell"><span class="avatar ${p.pm.role.startsWith("Contributor") ? "alt" : ""}">${p.pm.initials}</span>
        <span>${p.pm.name}<br><span style="font-size:.66rem;color:var(--ink-faint)">PM · ${p.pm.role}</span></span></span>
      <span>${days}</span>
    </div>
  </a>`;
}

function toast(msg) {
  let el = document.querySelector(".toast");
  if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 2600);
}
