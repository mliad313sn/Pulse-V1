"use strict";
// E23 — authoritative SERVER-SIDE export engine (plan §56, §91).
// Every export resolves its scope through projects.listPortfolio, i.e. the
// exact same authorization predicate as the dashboards (confidentiality,
// site isolation, filters). The client can only send filters — never project
// IDs — so a hidden project cannot be smuggled into a file (§85 "export
// scope resolution"). Finance columns appear ONLY for ADMIN/finance_access.
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const projects = require("../projects/service");
const { canFinance } = require("../finance/service");
const { query } = require("../../db/pool");

const GMT_STAMP = () => new Date().toISOString().slice(0, 16).replace("T", " ") + " GMT";

function scopeTitle(filters) {
  const parts = [];
  if (filters.site) parts.push(`Site ${filters.site}`);
  if (filters.division) parts.push(`Division ${filters.division}`);
  if (filters.stage) parts.push(`Stage ${filters.stage}`);
  if (filters.rag) parts.push(`RAG ${filters.rag}`);
  return parts.length ? parts.join(" · ") : "All active projects";
}

function kpis(rows) {
  const eff = (p) => p.rag_override || p.rag_computed;
  return {
    total: rows.length,
    g: rows.filter((p) => eff(p) === "G").length,
    a: rows.filter((p) => eff(p) === "A").length,
    r: rows.filter((p) => eff(p) === "R").length,
  };
}

// Finance totals for the exported projects — only called when authorized.
async function financeTotals(rows) {
  if (!rows.length) return { approved: 0, forecast: 0, actual: 0 };
  const ids = rows.map((p) => p.id);
  const { rows: fin } = await query(
    `SELECT coalesce(sum(b.approved * fx.rate_to_base),0) AS approved,
            coalesce(sum(b.forecast * fx.rate_to_base),0) AS forecast,
            coalesce(sum(b.actual * fx.rate_to_base),0) AS actual
       FROM budget_lines b JOIN fx_rates fx ON fx.currency = b.currency
      WHERE b.deleted_at IS NULL AND b.project_id = ANY($1::bigint[])`,
    [ids]
  );
  return { approved: Number(fin[0].approved), forecast: Number(fin[0].forecast), actual: Number(fin[0].actual) };
}

// ===== XLSX =====
async function portfolioXlsx(user, filters) {
  const rows = await projects.listPortfolio(user, filters);
  const finance = canFinance(user);
  const wb = new ExcelJS.Workbook();
  wb.creator = "PULSE";
  const ws = wb.addWorksheet("Portfolio");
  const columns = [
    { header: "Code", key: "code", width: 14 },
    { header: "Title", key: "title", width: 40 },
    { header: "Stage", key: "stage", width: 12 },
    { header: "Status", key: "operating_status", width: 13 },
    { header: "RAG", key: "rag", width: 6 },
    { header: "Priority", key: "priority", width: 8 },
    { header: "PM", key: "pm_name", width: 22 },
    { header: "Lead division", key: "lead_division_code", width: 12 },
    { header: "Sites", key: "sites", width: 18 },
    { header: "Portfolio", key: "portfolio_title", width: 22 },
    { header: "Program", key: "program_title", width: 22 },
    { header: "Progress %", key: "progress_pct", width: 10 },
    { header: "Target date", key: "target_date", width: 12 },
  ];
  if (finance) {
    columns.push(
      { header: "Approved", key: "fin_approved", width: 13 },
      { header: "Forecast", key: "fin_forecast", width: 13 },
      { header: "Actual", key: "fin_actual", width: 13 },
    );
  }
  ws.columns = columns;
  ws.getRow(1).font = { bold: true };

  let finByProject = new Map();
  if (finance && rows.length) {
    const { rows: fin } = await query(
      `SELECT b.project_id, coalesce(sum(b.approved * fx.rate_to_base),0) AS approved,
              coalesce(sum(b.forecast * fx.rate_to_base),0) AS forecast,
              coalesce(sum(b.actual * fx.rate_to_base),0) AS actual
         FROM budget_lines b JOIN fx_rates fx ON fx.currency = b.currency
        WHERE b.deleted_at IS NULL AND b.project_id = ANY($1::bigint[])
        GROUP BY b.project_id`,
      [rows.map((p) => p.id)]
    );
    finByProject = new Map(fin.map((f) => [f.project_id, f]));
  }
  for (const p of rows) {
    const f = finByProject.get(p.id);
    ws.addRow({
      code: p.code, title: p.title, stage: p.stage, operating_status: p.operating_status,
      rag: p.rag_override || p.rag_computed, priority: p.priority,
      pm_name: p.pm_name || "", lead_division_code: p.lead_division_code,
      sites: (p.sites || []).join(", "),
      portfolio_title: p.portfolio_title || "", program_title: p.program_title || "",
      progress_pct: p.progress_pct, target_date: p.target_date ? String(p.target_date).slice(0, 10) : "",
      ...(finance ? {
        fin_approved: f ? Number(f.approved) : 0,
        fin_forecast: f ? Number(f.forecast) : 0,
        fin_actual: f ? Number(f.actual) : 0,
      } : {}),
    });
  }
  const k = kpis(rows);
  ws.addRow({});
  ws.addRow({ code: "TOTAL", title: `${k.total} projects — G ${k.g} / A ${k.a} / R ${k.r}` });
  const buffer = await wb.xlsx.writeBuffer();
  return { buffer: Buffer.from(buffer), filename: `pulse-portfolio-${Date.now()}.xlsx`, rows: rows.length };
}

// ===== PDF =====
// compress:false keeps text streams readable so the leak tests can make
// SEMANTIC assertions on content (plan §91) — size cost is acceptable.
async function portfolioPdf(user, filters) {
  const rows = await projects.listPortfolio(user, filters);
  const finance = canFinance(user);
  const k = kpis(rows);
  const doc = new PDFDocument({ size: "A4", margin: 40, compress: false });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on("end", resolve));

  doc.fontSize(18).text(`PULSE Portfolio Report — ${scopeTitle(filters)}`);
  doc.fontSize(9).fillColor("#555").text(`Generated ${GMT_STAMP()} · for ${user.name} · ${k.total} projects (G ${k.g} / A ${k.a} / R ${k.r})`);
  doc.moveDown();
  if (finance) {
    const fin = await financeTotals(rows);
    doc.fontSize(10).fillColor("#000")
      .text(`Financials (authorized): approved ${fin.approved.toLocaleString("en-US")} · forecast ${fin.forecast.toLocaleString("en-US")} · actual ${fin.actual.toLocaleString("en-US")}`);
    doc.moveDown();
  }
  doc.fillColor("#000");
  for (const p of rows) {
    const rag = p.rag_override || p.rag_computed;
    doc.fontSize(11).text(`[${rag}] ${p.code} — ${p.title}`, { continued: false });
    doc.fontSize(8.5).fillColor("#444")
      .text(`   ${p.stage} · ${p.operating_status} · ${p.priority} · PM ${p.pm_name || "—"} · sites ${(p.sites || []).join(",") || "—"} · progress ${p.progress_pct}% · target ${p.target_date ? String(p.target_date).slice(0, 10) : "—"}`);
    doc.fillColor("#000").moveDown(0.4);
  }
  if (!rows.length) doc.fontSize(11).text("No projects in this scope.");
  doc.end();
  await done;
  return { buffer: Buffer.concat(chunks), filename: `pulse-portfolio-${Date.now()}.pdf`, rows: rows.length };
}

// ===== PPTX =====
async function portfolioPptx(user, filters) {
  // pptxgenjs is browser-first; in Node it still writes via JSZip
  const PptxGenJS = require("pptxgenjs");
  const rows = await projects.listPortfolio(user, filters);
  const k = kpis(rows);
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: 13.33, height: 7.5 });
  pptx.layout = "WIDE";

  const title = pptx.addSlide();
  title.addText(`PULSE Portfolio — ${scopeTitle(filters)}`, { x: 0.6, y: 1.6, w: 12, h: 1, fontSize: 30, bold: true, color: "1A3A5F" });
  title.addText(`${k.total} projects · G ${k.g} / A ${k.a} / R ${k.r} · Generated ${GMT_STAMP()}`, { x: 0.6, y: 2.7, w: 12, h: 0.5, fontSize: 14, color: "4a5d72" });

  const PAGE = 10;
  for (let i = 0; i < rows.length; i += PAGE) {
    const slide = pptx.addSlide();
    slide.addText(`Projects ${i + 1}–${Math.min(i + PAGE, rows.length)} of ${rows.length}`, { x: 0.6, y: 0.3, w: 12, h: 0.5, fontSize: 16, bold: true, color: "1A3A5F" });
    const tbl = [[
      { text: "RAG", options: { bold: true } }, { text: "Code", options: { bold: true } },
      { text: "Title", options: { bold: true } }, { text: "Stage", options: { bold: true } },
      { text: "PM", options: { bold: true } }, { text: "Target", options: { bold: true } },
    ]];
    for (const p of rows.slice(i, i + PAGE)) {
      tbl.push([
        { text: p.rag_override || p.rag_computed },
        { text: p.code }, { text: p.title }, { text: p.stage },
        { text: p.pm_name || "—" },
        { text: p.target_date ? String(p.target_date).slice(0, 10) : "—" },
      ]);
    }
    slide.addTable(tbl, { x: 0.6, y: 1.0, w: 12.1, fontSize: 11, border: { pt: 0.5, color: "dde4ec" } });
  }
  const buffer = Buffer.from(await pptx.write({ outputType: "nodebuffer" }));
  return { buffer, filename: `pulse-portfolio-${Date.now()}.pptx`, rows: rows.length, slides: 1 + Math.ceil(rows.length / PAGE) };
}

module.exports = { portfolioXlsx, portfolioPdf, portfolioPptx, scopeTitle };
