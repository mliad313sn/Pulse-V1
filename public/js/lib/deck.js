"use strict";
// Deck export engine (plan §5) — client-side PptxGenJS, Endeavour Group IT style.
// Colors come from the SAME CSS tokens as the app (public/css/tokens.css), so the
// app and decks can never drift.
import { state } from "./api.js";
import { fmtDate, monthYear, effectiveRag, toast } from "./ui.js";
import { ensurePptx } from "./vendor.js";

function tk() {
  const css = getComputedStyle(document.documentElement);
  const grab = (v) => css.getPropertyValue(v).trim().replace("#", "");
  return {
    navy: grab("--edv-navy"), orange: grab("--edv-orange"),
    G: grab("--rag-green"), A: grab("--rag-amber"), R: grab("--rag-red"),
    ink: "17293D", grey: "8496A9", line: "DDE4EC",
  };
}
const FONT = "Calibri";
const ragFill = (t, rag) => ({ G: t.G, A: t.A, R: t.R }[rag] || t.grey);

function newDeck(t) {
  const pptx = new window.PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: 13.33, height: 7.5 });
  pptx.layout = "WIDE";
  return pptx;
}

// standard slide chrome: navy title band + orange badge + footer
function chrome(pptx, t, title, subtitle) {
  const s = pptx.addSlide();
  s.background = { color: "FFFFFF" };
  s.addShape("rect", { x: 0, y: 0, w: 13.33, h: 0.85, fill: { color: t.navy } });
  s.addShape("rect", { x: 0, y: 0.85, w: 13.33, h: 0.045, fill: { color: t.orange } });
  s.addText(title, { x: 0.45, y: 0.08, w: 10.5, h: 0.7, fontFace: FONT, fontSize: 22, bold: true, color: "FFFFFF", valign: "middle" });
  if (subtitle) s.addText(subtitle, { x: 11, y: 0.08, w: 2.1, h: 0.7, fontFace: FONT, fontSize: 11, color: "FFFFFF", align: "right", valign: "middle" });
  s.addText(`Endeavour Mining — Group IT — ${monthYear()} — Confidential`, {
    x: 0.45, y: 7.12, w: 12.4, h: 0.3, fontFace: FONT, fontSize: 9, color: t.grey,
  });
  return s;
}

function titleSlide(pptx, t, main, sub, extra) {
  const s = pptx.addSlide();
  s.background = { color: t.navy };
  s.addShape("rect", { x: 0, y: 4.62, w: 13.33, h: 0.06, fill: { color: t.orange } });
  s.addText("PULSE", { x: 0.9, y: 1.15, w: 6, h: 0.5, fontFace: FONT, fontSize: 20, bold: true, color: t.orange, charSpacing: 4 });
  s.addText(main, { x: 0.9, y: 2.3, w: 11.5, h: 1.5, fontFace: FONT, fontSize: 40, bold: true, color: "FFFFFF" });
  s.addText(sub, { x: 0.9, y: 3.75, w: 11.5, h: 0.6, fontFace: FONT, fontSize: 18, color: "FFFFFF" });
  if (extra) s.addText(extra, { x: 0.9, y: 4.85, w: 11.5, h: 0.9, fontFace: FONT, fontSize: 13, color: "D5DEE8" });
  s.addText(`Endeavour Mining — Group IT — ${monthYear()} — Confidential`, {
    x: 0.9, y: 6.9, w: 11.5, h: 0.35, fontFace: FONT, fontSize: 10, color: "9FB2C5",
  });
}

const ragCell = (t, rag) => ({
  text: rag || "—",
  options: { fill: { color: ragFill(t, rag) }, color: "FFFFFF", bold: true, align: "center", fontFace: FONT },
});

function scopeTitle(filters) {
  if (filters?.site) return `IT Projects — ${filters.site}`;
  if (filters?.division) return `IT Projects — ${filters.division} division`;
  if (filters?.stage) return `IT Projects — ${filters.stage} stage`;
  return "IT Projects — Group Portfolio";
}
function scopeCode(filters) {
  return filters?.site || (filters?.division ? filters.division : "Group");
}

// ===== A. Group / filtered portfolio deck =====
export async function exportGroupDeck(projects, filters = {}) {
  await ensurePptx();
  const t = tk();
  const pptx = newDeck(t);
  const scope = scopeTitle(filters);

  // S1 title
  titleSlide(pptx, t, scope, `${monthYear()} · ${projects.length} project(s) in scope`,
    filters.site ? `Site-scoped export — generated from the live Portfolio filter` : "Generated from live PULSE data — no manual rework");

  // S2 KPI slide
  const g = projects.filter((p) => effectiveRag(p) === "G").length;
  const a = projects.filter((p) => effectiveRag(p) === "A").length;
  const r = projects.filter((p) => effectiveRag(p) === "R").length;
  const crit = projects.reduce((s, p) => s + (p.critical_roadblocks || 0), 0);
  const overdue = projects.reduce((s, p) => s + (p.overdue_actions || 0), 0);
  const s2 = chrome(pptx, t, "Portfolio health", scope.replace("IT Projects — ", ""));
  if (projects.length) {
    s2.addChart(pptx.ChartType.doughnut, [{
      name: "RAG", labels: ["Green", "Amber", "Red"], values: [g, a, r],
    }], {
      x: 0.7, y: 1.5, w: 4.4, h: 4.6, holeSize: 60, showLegend: true, legendPos: "b",
      chartColors: [t.G, t.A, t.R], legendFontFace: FONT, showTitle: false,
    });
  }
  const kpis = [
    [String(projects.length), "Projects"], [`${g} / ${a} / ${r}`, "Green / Amber / Red"],
    [String(crit), "Open critical roadblocks"], [String(overdue), "Overdue actions"],
  ];
  kpis.forEach(([num, label], i) => {
    const x = 5.6 + (i % 2) * 3.8, y = 1.7 + Math.floor(i / 2) * 2.2;
    s2.addShape("roundRect", { x, y, w: 3.5, h: 1.8, rectRadius: 0.06, fill: { color: "F4F6F9" }, line: { color: t.line } });
    s2.addText(num, { x, y: y + 0.25, w: 3.5, h: 0.8, align: "center", fontFace: FONT, fontSize: 30, bold: true, color: t.navy });
    s2.addText(label, { x, y: y + 1.05, w: 3.5, h: 0.5, align: "center", fontFace: FONT, fontSize: 12, color: t.grey });
  });

  // S3 portfolio table, 10 rows per slide
  const header = ["Code", "Project", "Lead", "Sites", "Stage", "RAG", "Next milestone", "Target"]
    .map((h) => ({ text: h, options: { fill: { color: t.navy }, color: "FFFFFF", bold: true, fontFace: FONT } }));
  for (let i = 0; i < projects.length; i += 10) {
    const page = projects.slice(i, i + 10);
    const s3 = chrome(pptx, t, `Portfolio${projects.length > 10 ? ` (${i / 10 + 1}/${Math.ceil(projects.length / 10)})` : ""}`, scope.replace("IT Projects — ", ""));
    s3.addTable([header, ...page.map((p) => [
      { text: p.code, options: { fontFace: FONT, bold: true } },
      { text: p.title, options: { fontFace: FONT } },
      { text: p.lead_division_code || "", options: { fontFace: FONT } },
      { text: (p.sites || []).join(", "), options: { fontFace: FONT } },
      { text: p.stage.replace("_", " "), options: { fontFace: FONT } },
      ragCell(t, effectiveRag(p)),
      { text: p.next_milestone ? `${p.next_milestone.title} (${fmtDate(p.next_milestone.due_date)})` : "—", options: { fontFace: FONT } },
      { text: fmtDate(p.target_date), options: { fontFace: FONT } },
    ])], {
      x: 0.45, y: 1.15, w: 12.45, fontSize: 10.5, rowH: 0.42, border: { pt: 0.5, color: t.line },
      colW: [1.25, 3.3, 0.75, 1.35, 0.95, 0.65, 3.0, 1.2], valign: "middle",
    });
  }

  // S4 roadblocks requiring leadership (CRITICAL from cards; skip if none)
  const leadership = projects.filter((p) => p.top_roadblock && p.top_roadblock.severity === "CRITICAL");
  if (leadership.length) {
    const s4 = chrome(pptx, t, "Roadblocks requiring leadership", scope.replace("IT Projects — ", ""));
    s4.addTable([
      ["Project", "Roadblock", "RAG"].map((h) => ({ text: h, options: { fill: { color: t.navy }, color: "FFFFFF", bold: true, fontFace: FONT } })),
      ...leadership.slice(0, 12).map((p) => [
        { text: `${p.code} ${p.title}`, options: { fontFace: FONT } },
        { text: p.top_roadblock.title, options: { fontFace: FONT } },
        ragCell(t, effectiveRag(p)),
      ]),
    ], { x: 0.45, y: 1.15, w: 12.45, fontSize: 12, rowH: 0.5, border: { pt: 0.5, color: t.line }, colW: [4.2, 7.3, 0.95], valign: "middle" });
  }

  // S5 per-division one-liners (skip when a single-division filter)
  if (!filters.division) {
    const byDiv = {};
    for (const p of projects) {
      const d = p.lead_division_code || "?";
      (byDiv[d] ||= []).push(p);
    }
    const s5 = chrome(pptx, t, "Division snapshot", scope.replace("IT Projects — ", ""));
    const lines = Object.entries(byDiv).map(([code, list]) => {
      const red = list.filter((p) => effectiveRag(p) === "R").length;
      return [
        { text: `${code}  `, options: { bold: true, color: t.navy, fontFace: FONT, fontSize: 14 } },
        { text: `${list.length} project(s) led${red ? `, ${red} RED` : ", none red"} — ${list.slice(0, 3).map((p) => p.title).join("; ")}${list.length > 3 ? "…" : ""}\n`, options: { fontFace: FONT, fontSize: 13, color: t.ink } },
      ];
    }).flat();
    s5.addText(lines, { x: 0.6, y: 1.3, w: 12.1, h: 5.4, valign: "top", lineSpacing: 26 });
  }

  // S6 executive commentary from RED/AMBER exec_commentary (needs detail payload —
  // cards may not carry it; skip silently when absent)
  const withExec = projects.filter((p) => (effectiveRag(p) !== "G") && p.exec_commentary);
  if (withExec.length) {
    const s6 = chrome(pptx, t, "Executive commentary", scope.replace("IT Projects — ", ""));
    let y = 1.2;
    for (const p of withExec.slice(0, 4)) {
      s6.addShape("rect", { x: 0.45, y, w: 12.45, h: 1.32, fill: { color: t.navy } });
      s6.addShape("rect", { x: 0.45, y, w: 0.09, h: 1.32, fill: { color: ragFill(t, effectiveRag(p)) } });
      s6.addText([
        { text: `${p.code} ${p.title}\n`, options: { bold: true, color: t.orange, fontSize: 12.5, fontFace: FONT } },
        { text: p.exec_commentary, options: { color: "FFFFFF", fontSize: 11.5, fontFace: FONT } },
      ], { x: 0.7, y: y + 0.08, w: 12, h: 1.16, valign: "top" });
      y += 1.5;
    }
  }

  const fname = `PULSE_${scopeCode(filters)}_${new Date().toISOString().slice(0, 10)}.pptx`;
  await pptx.writeFile({ fileName: fname });
  toast(`Deck exported: ${fname}`);
}

// ===== B. Project deck (7 slides) =====
export async function exportProjectDeck(detail) {
  await ensurePptx();
  const t = tk();
  const p = detail.project;
  const pptx = newDeck(t);
  const rag = effectiveRag(p);

  // S1 title
  titleSlide(pptx, t, p.title,
    `${p.code} · ${p.stage.replace("_", " ")} · RAG ${rag}${p.rag_override ? " (manual)" : ""}`,
    `PM: ${detail.pm?.name || "—"} · Sponsor: ${p.sponsor || "—"}`);

  // S2 elevator card
  const s2 = chrome(pptx, t, "In one look", p.code);
  s2.addText(p.description || "No description.", { x: 0.6, y: 1.25, w: 7.4, h: 1.7, fontFace: FONT, fontSize: 13.5, color: t.ink, valign: "top" });
  const facts = [
    ["Divisions", detail.divisions.map((d) => `${d.code}${d.role_in_project === "LEAD" ? " (lead)" : ""}`).join(", ")],
    ["Sites", detail.sites.map((s) => s.code).join(", ") || "—"],
    ["Start → Target", `${fmtDate(p.start_date)} → ${fmtDate(p.target_date)}`],
    ["Priority", p.priority],
    ["Progress (computed)", `${p.progress_pct}% — ${detail.milestones.filter((x) => x.status === "DONE").length}/${detail.milestones.length} milestones done`],
  ];
  facts.forEach(([k, v], i) => {
    s2.addText(k, { x: 8.3, y: 1.25 + i * 0.62, w: 2.1, h: 0.5, fontFace: FONT, fontSize: 11, color: t.grey });
    s2.addText(v, { x: 10.4, y: 1.25 + i * 0.62, w: 2.5, h: 0.5, fontFace: FONT, fontSize: 11.5, bold: true, color: t.ink });
  });
  // stage stepper
  const stages = ["IDEA", "DESIGN", "BUILD", "DEPLOY", "RUN"];
  const idx = stages.indexOf(p.stage);
  stages.forEach((st, i) => {
    const x = 0.6 + i * 1.55;
    const fill = i < idx ? t.G : i === idx ? t.orange : "EFF2F6";
    s2.addShape("roundRect", { x, y: 3.6, w: 1.35, h: 0.5, rectRadius: 0.25, fill: { color: fill } });
    s2.addText(st, { x, y: 3.6, w: 1.35, h: 0.5, align: "center", valign: "middle", fontFace: FONT, fontSize: 10.5, bold: true, color: i <= idx ? "FFFFFF" : t.grey });
  });
  // progress bar
  s2.addShape("rect", { x: 0.6, y: 4.6, w: 7.2, h: 0.35, fill: { color: "EFF2F6" } });
  s2.addShape("rect", { x: 0.6, y: 4.6, w: Math.max(7.2 * (p.progress_pct / 100), 0.01), h: 0.35, fill: { color: t.G } });
  s2.addText(`${p.progress_pct}%`, { x: 7.9, y: 4.55, w: 1, h: 0.45, fontFace: FONT, fontSize: 13, bold: true, color: t.navy });

  // S3 timeline: milestones as shapes on a date axis
  const dated = detail.milestones.filter((m) => m.due_date);
  if (dated.length) {
    const s3 = chrome(pptx, t, "Timeline", p.code);
    const times = dated.map((m) => new Date(m.due_date).getTime());
    const min = Math.min(...times), max = Math.max(...times), span = Math.max(max - min, 1);
    const X = (time) => 0.9 + ((time - min) / span) * 11.4;
    s3.addShape("line", { x: 0.9, y: 4.1, w: 11.4, h: 0, line: { color: t.line, width: 2 } });
    const today = Date.now();
    if (today >= min && today <= max) {
      s3.addShape("line", { x: X(today), y: 1.6, w: 0, h: 3.4, line: { color: t.orange, width: 1.5, dashType: "dash" } });
      s3.addText("today", { x: X(today) - 0.5, y: 1.25, w: 1, h: 0.3, align: "center", fontFace: FONT, fontSize: 9, color: t.orange, bold: true });
    }
    dated.forEach((m, i) => {
      const overdue = m.status !== "DONE" && new Date(m.due_date) < new Date();
      const color = m.status === "DONE" ? t.G : m.status === "SLIPPED" || overdue ? t.R : t.grey;
      const x = X(new Date(m.due_date).getTime());
      const isGate = m.type === "SECURITY_GATE" || m.type === "GO_LIVE";
      s3.addShape(isGate ? "diamond" : "ellipse", { x: x - 0.14, y: 3.96, w: 0.28, h: 0.28, fill: { color } });
      const above = i % 2 === 0;
      s3.addText(`${m.title}\n${fmtDate(m.due_date)}`, {
        x: x - 1.05, y: above ? 2.85 : 4.4, w: 2.1, h: 0.95, align: "center",
        fontFace: FONT, fontSize: 9.5, color: t.ink, valign: above ? "bottom" : "top",
      });
    });
    // legend
    [["DONE", t.G], ["SLIPPED / overdue", t.R], ["Planned", t.grey]].forEach(([lbl, c], i) => {
      s3.addShape("ellipse", { x: 0.9 + i * 2.2, y: 6.35, w: 0.18, h: 0.18, fill: { color: c } });
      s3.addText(lbl, { x: 1.15 + i * 2.2, y: 6.26, w: 2, h: 0.35, fontFace: FONT, fontSize: 10, color: t.grey });
    });
  }

  // S4 roadblocks & mitigations
  const openRbs = detail.roadblocks.filter((r) => r.status !== "RESOLVED");
  if (openRbs.length) {
    const s4 = chrome(pptx, t, "Roadblocks & mitigations", p.code);
    s4.addTable([
      ["Roadblock", "Severity", "Owner", "Due", "Status"].map((h) => ({ text: h, options: { fill: { color: t.navy }, color: "FFFFFF", bold: true, fontFace: FONT } })),
      ...openRbs.slice(0, 10).map((r) => [
        { text: r.title + (r.description ? ` — ${r.description}` : ""), options: { fontFace: FONT } },
        { text: r.severity, options: { fill: { color: r.severity === "CRITICAL" ? t.R : r.severity === "MAJOR" ? t.A : t.grey }, color: "FFFFFF", bold: true, align: "center", fontFace: FONT } },
        { text: r.owner_name || "—", options: { fontFace: FONT } },
        { text: fmtDate(r.due_date), options: { fontFace: FONT } },
        { text: r.status.replace("_", " "), options: { fontFace: FONT } },
      ]),
    ], { x: 0.45, y: 1.15, w: 12.45, fontSize: 11.5, rowH: 0.5, border: { pt: 0.5, color: t.line }, colW: [6.2, 1.3, 2.0, 1.4, 1.55], valign: "middle" });
  }

  // S5 next actions
  const openActs = detail.actions.filter((a) => a.status === "OPEN");
  if (openActs.length) {
    const s5 = chrome(pptx, t, "Next actions", p.code);
    s5.addTable([
      ["Action", "Owner", "Due"].map((h) => ({ text: h, options: { fill: { color: t.navy }, color: "FFFFFF", bold: true, fontFace: FONT } })),
      ...openActs.slice(0, 12).map((a) => [
        { text: a.title, options: { fontFace: FONT } },
        { text: a.owner_name || "—", options: { fontFace: FONT } },
        { text: fmtDate(a.due_date), options: { fontFace: FONT, color: a.due_date && new Date(a.due_date) < new Date() ? t.R : t.ink, bold: a.due_date && new Date(a.due_date) < new Date() } },
      ]),
    ], { x: 0.45, y: 1.15, w: 12.45, fontSize: 11.5, rowH: 0.46, border: { pt: 0.5, color: t.line }, colW: [8.2, 2.6, 1.65], valign: "middle" });
  }

  // S6 decisions log
  if (detail.decisions.length) {
    const s6 = chrome(pptx, t, "Decisions log", p.code);
    s6.addTable([
      ["Decision", "Decided by", "Date"].map((h) => ({ text: h, options: { fill: { color: t.navy }, color: "FFFFFF", bold: true, fontFace: FONT } })),
      ...detail.decisions.slice(0, 12).map((x) => [
        { text: x.text, options: { fontFace: FONT } },
        { text: x.decided_by || "—", options: { fontFace: FONT } },
        { text: fmtDate(x.date), options: { fontFace: FONT } },
      ]),
    ], { x: 0.45, y: 1.15, w: 12.45, fontSize: 11.5, rowH: 0.46, border: { pt: 0.5, color: t.line }, colW: [8.2, 2.6, 1.65], valign: "middle" });
  }

  // S7 exec commentary band
  if (p.exec_commentary) {
    const s7 = chrome(pptx, t, "Executive commentary", p.code);
    s7.addShape("rect", { x: 0.45, y: 1.4, w: 12.45, h: 3.4, fill: { color: t.navy } });
    s7.addShape("rect", { x: 0.45, y: 1.4, w: 0.12, h: 3.4, fill: { color: ragFill(t, rag) } });
    s7.addText(p.exec_commentary, { x: 0.85, y: 1.7, w: 11.8, h: 2.8, fontFace: FONT, fontSize: 16, color: "FFFFFF", valign: "top", lineSpacing: 26 });
  }

  const fname = `PULSE_${p.code}_${new Date().toISOString().slice(0, 10)}.pptx`;
  await pptx.writeFile({ fileName: fname });
  toast(`Deck exported: ${fname}`);
}
