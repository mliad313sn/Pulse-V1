"use strict";
// E23 — server-side export engine: filter parity, authorization parity and
// SEMANTIC leak tests (plan §56, §91). The seeded scenario plants:
//   - a confidential project ("Skunkworks Divestment") hidden from viewer,
//   - a site-restricted contributor (SGO) who must never export HGO data,
//   - budget lines that must be invisible without finance access.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const { initDb, fixtures, login, closePool, createApp, query } = require("../helpers");

let app, F, admin, infLead, contribSGO, viewer;
let sgoProject, hgoProject, confProject;

const CONF_TITLE = "Skunkworks Divestment";
const HGO_TITLE = "HGO Crusher Network";
const SGO_TITLE = "SGO Fuel Telemetry";

function bufOf(res) { return Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body); }

// pdfkit (compress:false) writes text as hex runs inside TJ arrays, split for
// kerning — decode and concatenate them to reconstruct the document text.
function pdfText(buf) {
  let out = "";
  for (const m of buf.toString("latin1").matchAll(/<([0-9a-fA-F]+)>/g)) {
    out += Buffer.from(m[1], "hex").toString("latin1");
  }
  return out;
}

before(async () => {
  await initDb();
  F = await fixtures();
  app = createApp();
  [admin, infLead, contribSGO, viewer] = await Promise.all([
    login(app, "admin@test.local"), login(app, "inf@test.local"),
    login(app, "awa@test.local"), login(app, "viewer@test.local"),
  ]);
  // restrict Awa (SGO contributor) to her site
  await admin.put(`/api/v1/auth/users/${F.U.contribSGO}`).send({ enterpriseAccess: false, active: true });

  sgoProject = (await infLead.post("/api/v1/projects").send({
    title: SGO_TITLE, lead_division_id: F.D.INF, sites: [F.S.SGO],
  })).body.project;
  hgoProject = (await infLead.post("/api/v1/projects").send({
    title: HGO_TITLE, lead_division_id: F.D.INF, sites: [F.S.HGO],
  })).body.project;
  confProject = (await admin.post("/api/v1/projects").send({
    title: CONF_TITLE, lead_division_id: F.D.INF, confidential: true, sites: [F.S.HGO],
  })).body.project;
  await admin.post(`/api/v1/projects/${hgoProject.id}/budget-lines`)
    .send({ category: "Hardware", approved: 777001, forecast: 777001 });
  // re-login so the enterprise flag is live
  contribSGO = await login(app, "awa@test.local");
});
after(closePool);

test("E23 xlsx: opens, expected columns/rows, finance only for authorized, no confidential leak", async () => {
  const resAdmin = await admin.agent.get("/api/v1/exports/portfolio.xlsx").buffer(true)
    .parse((res, cb) => { const c = []; res.on("data", (d) => c.push(d)); res.on("end", () => cb(null, Buffer.concat(c))); });
  assert.equal(resAdmin.status, 200);
  const wbA = new ExcelJS.Workbook();
  await wbA.xlsx.load(bufOf(resAdmin));
  const wsA = wbA.getWorksheet("Portfolio");
  const headersA = wsA.getRow(1).values.slice(1);
  assert.ok(headersA.includes("Code") && headersA.includes("RAG") && headersA.includes("Sites"));
  assert.ok(headersA.includes("Approved"), "admin sees finance columns");
  assert.equal(resAdmin.headers["x-export-rows"], "3", "admin exports all three projects");

  const resViewer = await viewer.agent.get("/api/v1/exports/portfolio.xlsx").buffer(true)
    .parse((res, cb) => { const c = []; res.on("data", (d) => c.push(d)); res.on("end", () => cb(null, Buffer.concat(c))); });
  assert.equal(resViewer.status, 200);
  const wbV = new ExcelJS.Workbook();
  await wbV.xlsx.load(bufOf(resViewer));
  const wsV = wbV.getWorksheet("Portfolio");
  const headersV = wsV.getRow(1).values.slice(1);
  assert.ok(!headersV.includes("Approved"), "no finance columns without the flag");
  assert.equal(resViewer.headers["x-export-rows"], "2", "confidential project excluded for viewer");
  let all = "";
  wsV.eachRow((row) => { all += JSON.stringify(row.values); });
  assert.ok(!all.includes(CONF_TITLE), "confidential title absent from viewer workbook");
  assert.ok(!all.includes("777001"), "finance figure absent from viewer workbook");
  assert.ok(all.includes(SGO_TITLE) && all.includes(HGO_TITLE), "authorized rows present");
});

test("E23 site isolation: restricted user's export contains ONLY own-site projects", async () => {
  const res = await contribSGO.agent.get("/api/v1/exports/portfolio.pdf").buffer(true)
    .parse((r, cb) => { const c = []; r.on("data", (d) => c.push(d)); r.on("end", () => cb(null, Buffer.concat(c))); });
  assert.equal(res.status, 200);
  const pdf = bufOf(res);
  assert.equal(pdf.slice(0, 5).toString(), "%PDF-", "valid PDF header");
  const text = pdfText(pdf);
  assert.ok(text.includes(SGO_TITLE), "own-site project present");
  assert.ok(!text.includes(HGO_TITLE), "other-site project absent (site isolation)");
  assert.ok(!text.includes(CONF_TITLE), "confidential absent");
  assert.equal(res.headers["x-export-rows"], "1");
});

test("E23 pdf filter parity: site filter adapts title and scope; finance line only when authorized", async () => {
  const res = await admin.agent.get("/api/v1/exports/portfolio.pdf?site=HGO").buffer(true)
    .parse((r, cb) => { const c = []; r.on("data", (d) => c.push(d)); r.on("end", () => cb(null, Buffer.concat(c))); });
  const text = pdfText(bufOf(res));
  assert.ok(text.includes("Site HGO"), "title adapts to the site filter");
  assert.ok(text.includes(HGO_TITLE) && text.includes(CONF_TITLE), "admin sees both HGO projects");
  assert.ok(!text.includes(SGO_TITLE), "filter excludes other sites");
  assert.ok(text.includes("777,001") || text.includes("777001"), "admin PDF shows finance totals");

  const resV = await viewer.agent.get("/api/v1/exports/portfolio.pdf?site=HGO").buffer(true)
    .parse((r, cb) => { const c = []; r.on("data", (d) => c.push(d)); r.on("end", () => cb(null, Buffer.concat(c))); });
  const textV = pdfText(bufOf(resV));
  assert.ok(!textV.includes("777"), "no finance figures for unauthorized viewer");
  assert.ok(!textV.includes(CONF_TITLE), "confidential still hidden under filters");
});

test("E23 pptx: opens as zip, slide count matches, title adapts, no unauthorized strings", async () => {
  const res = await viewer.agent.get("/api/v1/exports/portfolio.pptx?site=SGO").buffer(true)
    .parse((r, cb) => { const c = []; r.on("data", (d) => c.push(d)); r.on("end", () => cb(null, Buffer.concat(c))); });
  assert.equal(res.status, 200);
  const buf = bufOf(res);
  assert.equal(buf.slice(0, 2).toString(), "PK", "valid OOXML zip container");

  // semantic check: unzip slide XML and inspect actual text
  const JSZip = require("jszip"); // hoisted dep of exceljs/pptxgenjs
  const zip = await JSZip.loadAsync(buf);
  const slideNames = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  assert.equal(slideNames.length, 2, "title slide + one table slide");
  let xml = "";
  for (const n of slideNames) xml += await zip.files[n].async("string");
  assert.ok(xml.includes("Site SGO"), "deck title adapts to filter");
  assert.ok(xml.includes(SGO_TITLE), "authorized project present");
  assert.ok(!xml.includes(HGO_TITLE), "filtered-out project absent");
  assert.ok(!xml.includes(CONF_TITLE), "confidential project absent from deck XML");
  assert.ok(!xml.includes(confProject.code), "confidential project CODE absent too");
});
