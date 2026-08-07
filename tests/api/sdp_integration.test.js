"use strict";
// PULSE ↔ SDP integration — the identity spine, the capacity ledger and the
// governance controls.
//
// The SDP source is represented by the `sdp_fdw` staging schema, which has the
// exact shape of the real foreign tables. Seeding it here proves the whole
// chain — alias → attribution → mart → local copy → ledger → UI payload —
// without needing the production database, and the production path differs
// only in what is mounted at sdp_fdw.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initDb, fixtures, login, closePool, createApp, query } = require("../helpers");
const ledger = require("../../src/modules/resources/ledger");

let app, F, admin, infLead, contribSGO;

const thisPeriod = () => new Date().toISOString().slice(0, 7);
const periodOffset = (n) => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)).toISOString().slice(0, 7);
};

async function clearSdp() {
  await query(`TRUNCATE sdp_fdw.request_records, sdp_fdw.request_worklogs,
                        sdp_fdw.change_records, sdp_fdw.md_meetings, sdp_fdw.md_meeting_projects,
                        sdp_fdw.md_issues, sdp_fdw.md_actions, sdp_fdw.insp_inspections,
                        sdp_fdw.insp_actions, sdp_fdw.tracker_inputs_v2, sdp_fdw.survey_results`);
}

before(async () => {
  await initDb();
  F = await fixtures();
  app = createApp();
  [admin, infLead, contribSGO] = await Promise.all([
    login(app, "admin@test.local"), login(app, "inf@test.local"), login(app, "awa@test.local"),
  ]);
  await clearSdp();
});
after(closePool);

// ===================== PHASE 0 =====================

test("P0 the site Rosetta resolves every module's spelling onto one canonical code", async () => {
  // The three-way collision on Ity: tickets say ITY, inspection and meetings
  // say SMI, the risk register says IGO. All must land on one code.
  const { rows: ity } = await query(
    `SELECT system, alias, code FROM emid.site_alias
      WHERE (system, alias) IN (('TRACKER','ITY'), ('INSPECTION','SMI'), ('MEETINGS','SMI'), ('RISK_REGISTER','IGO'))`);
  assert.equal(ity.length, 4, "all four Ity spellings are mapped");
  assert.ok(ity.every((r) => r.code === "ITY"), "and they all resolve to ITY");

  // Ouagadougou: OUA / EDV / OUAGA OFF1
  const { rows: oua } = await query(
    `SELECT code FROM emid.site_alias
      WHERE (system, alias) IN (('TRACKER','EDV'), ('INSPECTION','OUA'), ('RISK_REGISTER','OUAGA OFF1'))`);
  assert.equal(oua.length, 3);
  assert.ok(oua.every((r) => r.code === "OUA"));

  // The workload key: tech_group → site. Both Mana spellings, one site.
  const { rows: mana } = await query(
    `SELECT code FROM emid.site_alias
      WHERE system = 'SDP_TECH_GROUP' AND alias IN ('Mana IT Agent','Mana IT Agents')`);
  assert.equal(mana.length, 2);
  assert.ok(mana.every((r) => r.code === "MGO"));

  // All three infosec casings are one group, mapped to one division.
  const { rows: sec } = await query(
    `SELECT code FROM emid.org_alias
      WHERE system = 'SDP_TECH_GROUP' AND alias IN ('infosec team','Infosec team','Infosec Team')`);
  assert.equal(sec.length, 3);
  assert.ok(sec.every((r) => r.code === "SEC"));

  // Kalana: tracker calls it KLN, everyone else KGO.
  const { rows: kln } = await query(
    `SELECT code FROM emid.site_alias WHERE system = 'TRACKER' AND alias = 'KLN'`);
  assert.equal(kln[0].code, "KGO");
});

test("P0 defects D4 and D5 are fixed: SML is Lafigué, and four missing sites exist", async () => {
  const { rows: sml } = await query(`SELECT name FROM sites WHERE code = 'SML'`);
  assert.equal(sml[0].name, "Lafigué", "D4: SML is Lafigué, not Sissingué");

  const { rows: added } = await query(
    `SELECT code FROM sites WHERE code IN ('EXPLO','TND','ASSAFO','MASSAWA') AND deleted_at IS NULL`);
  assert.equal(added.length, 4, "D5: the four sites present in SDP now exist in PULSE");
});

test("P0 department labels are mapped to a visible UNMAPPED bucket, never dropped", async () => {
  const { rows } = await query(
    `SELECT alias, code FROM emid.site_alias
      WHERE system = 'SDP_TICKET_LABEL' AND alias IN ('CLINIC','QHSE','AVIATION','Supply')`);
  assert.equal(rows.length, 4);
  assert.ok(rows.every((r) => r.code === "UNMAPPED"),
    "a department is not a site, but its tickets stay visible rather than vanishing");

  // London is mapped but explicitly out of scope pending decision Q2.
  const { rows: corp } = await query(`SELECT in_scope FROM emid.site WHERE code = 'CORPORATE'`);
  assert.equal(corp[0].in_scope, false, "41% of history is corporate — excluded explicitly, not silently");
});

test("P0 alias resolution: provable matches commit, fuzzy ones queue for a human", async () => {
  // A real person, seeded through the canonical register
  const person = (await admin.post("/api/v1/emid/people").send({
    display_name: "Veh Frédéric MAÏKA", site_code: "SML", employment: "STAFF",
  })).body.person;
  assert.ok(person.person_id);

  const res = await admin.post("/api/v1/emid/aliases/resolve").send({
    system: "SDP_TECHNICIAN",
    aliases: [
      "Veh Frédéric MAÏKA",       // exact
      "VEH FREDERIC MAIKA",        // unaccented — provable, auto-commits
      "Veh Frederic MAIKAA",       // one character out — fuzzy, must QUEUE
      "Sabodala",                  // service account
      "Help Simply Network",       // vendor
      "Completely Unknown Person", // no candidate
    ],
  });
  assert.equal(res.status, 200);
  const s = res.body;
  assert.ok(s.exact >= 1, "the exact spelling resolves");
  assert.ok(s.unaccent >= 1, "the unaccented spelling resolves — it is provably the same string");
  assert.equal(s.service_accounts, 1, "shared mailboxes are classified, not matched");
  assert.equal(s.vendors, 1, "vendors are classified separately — they change every headroom figure");
  assert.ok(s.queued_fuzzy + s.queued_unknown >= 2, "anything softer than provable waits for a human");

  // The fuzzy candidate must NOT have been committed
  const { rows: fuzzy } = await query(
    `SELECT person_id, match_method, confidence FROM emid.person_alias
      WHERE system = 'SDP_TECHNICIAN' AND alias = 'Veh Frederic MAIKAA'`);
  assert.equal(fuzzy[0].person_id, null, "a fuzzy match never auto-commits into a capacity number");

  // A human confirms it, and the evidence is recorded
  const confirmed = await admin.post("/api/v1/emid/aliases/confirm")
    .send({ system: "SDP_TECHNICIAN", alias: "Veh Frederic MAIKAA", person_id: person.person_id });
  assert.equal(confirmed.status, 200);
  assert.equal(Number(confirmed.body.alias.person_id), person.person_id);
  assert.ok(confirmed.body.alias.confirmed_by, "who confirmed it is recorded");
  assert.ok(confirmed.body.alias.confirmed_at, "and when");

  // A rejected alias stays rejected instead of coming back every night
  await admin.post("/api/v1/emid/aliases/reject")
    .send({ system: "SDP_TECHNICIAN", alias: "Completely Unknown Person", note: "Not an Endeavour employee" });
  const pending = await admin.get("/api/v1/emid/aliases/pending");
  assert.ok(!pending.body.pending.some((p) => p.alias === "Completely Unknown Person"));

  // Only Admins touch the identity register
  assert.equal((await infLead.post("/api/v1/emid/aliases/resolve")
    .send({ system: "SDP_TECHNICIAN", aliases: ["x"] })).status, 403);
});

test("P0 known duplicate spellings from the dump are pre-seeded as one human", async () => {
  const res = await admin.post("/api/v1/emid/aliases/seed-known-pairs");
  assert.equal(res.status, 200);
  assert.ok(res.body.pairs >= 12);

  // The double-space spelling in SDP users must resolve to the same person as
  // the single-space one — this is exactly what naive joining gets wrong.
  const { rows } = await query(
    `SELECT DISTINCT person_id FROM emid.person_alias
      WHERE alias IN ('Kouassi Bah Jean Pierre YAO', 'Kouassi Bah Jean Pierre  YAO', 'Jean Pierre YAO')
        AND person_id IS NOT NULL`);
  assert.equal(rows.length, 1, "three spellings, one human");
});

// ===================== PHASE 1 =====================

test("P1 defect D1: capacity is measured in hours, and leave reduces it", async () => {
  const period = thisPeriod();
  const res = await admin.put("/api/v1/person-capacity").send({
    user_id: F.U.contribSGO, period, fte: 1.0, standard_hours: 173,
    leave_hours: 16, training_hours: 8, note: "Two days leave, one day training",
  });
  assert.equal(res.status, 200);
  assert.equal(Number(res.body.capacity.available_hours), 149, "173 − 16 − 8");

  // Nonsense is refused with an explanation rather than stored
  const bad = await admin.put("/api/v1/person-capacity").send({
    user_id: F.U.contribSGO, period, fte: 1.0, standard_hours: 173, leave_hours: 200,
  });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /exceeds this person's/);
});

test("P1 defect D2: people with NO project allocation still appear — they are the point", async () => {
  const period = thisPeriod();
  await admin.post("/api/v1/person-capacity/seed").send({ periods: [period] });

  // contribHGO has no allocations at all. The old workload() hid exactly this
  // person behind `HAVING sum(percent) > 0`.
  const res = await admin.get(`/api/v1/reports/capacity-ledger?from=${period}&months=1`);
  assert.equal(res.status, 200);
  const hgo = res.body.rows.find((r) => r.user_id === F.U.contribHGO);
  assert.ok(hgo, "a person with zero project allocations is present in the ledger");
  assert.equal(hgo.periods[0].project_hours, 0);
  assert.ok(hgo.periods[0].available_hours > 0, "and has a real denominator");

  // The legacy workload report is fixed too
  const legacy = await admin.get("/api/v1/reports/workload");
  assert.ok(legacy.body.rows.some((r) => r.user_id === F.U.contribHGO),
    "the legacy workload report no longer hides unallocated people");
});

test("P1 defect D3: the ledger is a forward month grid, not a snapshot", async () => {
  const res = await admin.get(`/api/v1/reports/capacity-ledger?from=${periodOffset(0)}&months=6`);
  assert.equal(res.body.window.periods.length, 6, "six months, so October can be asked about in June");
  assert.equal(res.body.window.periods[0], periodOffset(0));
  assert.equal(res.body.window.periods[5], periodOffset(5));
  for (const row of res.body.rows) assert.equal(row.periods.length, 6);
});

test("P1 the full chain: SDP tickets → attribution → mart → local copy → headroom", async () => {
  const period = thisPeriod();
  const firstDay = `${period}-05T09:00:00Z`;

  // A person who exists in PULSE, in emid, and in SDP under a messy spelling
  const person = (await admin.post("/api/v1/emid/people").send({
    display_name: "Fatou THIAM", site_code: "SGO", employment: "STAFF", user_id: F.U.contribSGO,
  })).body.person;
  await admin.post("/api/v1/emid/aliases/resolve")
    .send({ system: "SDP_TECHNICIAN", aliases: ["Fatou THIAM", "Fatou Thiam"] });

  // 40 tickets in Sabodala's group this month, mixed types
  const rows = [];
  for (let i = 1; i <= 40; i++) {
    rows.push(`(${i}, '${firstDay}'::timestamptz, ${i % 3 === 0 ? "'Fatou Thiam'" : "'Fatou THIAM'"},
                'Sabodala IT Agents', 'Sabodala',
                ${i % 4 === 0 ? "'Incident'" : "'Service Request'"},
                'IT Infrastructure', ${i % 10 === 0 ? 1 : 0})`);
  }
  await query(
    `INSERT INTO sdp_fdw.request_records
       (request_id, created_time, technician, tech_group, site, request_type, category, overdue_status)
     VALUES ${rows.join(",")}`);

  // Unattributable load, which must stay visible
  await query(
    `INSERT INTO sdp_fdw.request_records
       (request_id, created_time, technician, tech_group, site, request_type, category)
     VALUES (9001, $1::timestamptz, NULL, 'Sabodala IT Agents', 'Sabodala', 'Incident', 'Email'),
            (9002, $1::timestamptz, 'Ghost Technician', 'Sabodala IT Agents', 'Sabodala', 'Incident', 'Email')`,
    [firstDay]);

  const imported = await admin.post("/api/v1/emid/import/bau");
  assert.equal(imported.status, 200, JSON.stringify(imported.body));
  assert.equal(imported.body.ok, true);
  assert.ok(imported.body.helpdesk_rows >= 1);

  // The local copy exists — PULSE renders from this, not from SDP
  const { rows: local } = await query(
    `SELECT tickets, hours, provenance FROM bau_load
      WHERE user_id = $1 AND period = $2 AND source = 'HELPDESK'`, [F.U.contribSGO, period]);
  assert.equal(local.length, 1);
  assert.equal(local[0].tickets, 40, "both spellings of her name counted as one person");
  assert.equal(local[0].provenance, "MODELLED", "no worklogs exist, so hours are modelled and say so");
  assert.ok(Number(local[0].hours) > 0);

  // The ledger now shows helpdesk load eating into headroom, with the arithmetic
  const led = await admin.get(`/api/v1/reports/capacity-ledger?from=${period}&months=1`);
  const cell = led.body.rows.find((r) => r.user_id === F.U.contribSGO).periods[0];
  assert.equal(cell.helpdesk_tickets, 40);
  assert.ok(cell.helpdesk_hours > 0);
  assert.equal(cell.provenance, "MODELLED");
  assert.equal(cell.data_confidence, "LOW", "modelled hours are low-confidence, and the UI must say so");
  assert.match(cell.explanation, /h available · helpdesk .* h \(40 tickets, modelled\).*headroom/);
  assert.ok(led.body.as_of, "and the copy carries an 'as of' stamp");

  // Anti-sandbagging: what could not be attributed is visible
  const un = await admin.get(`/api/v1/reports/unattributed-load?from=${period}&months=1`);
  assert.ok(un.body.total_unattributed >= 2, "unattributed tickets are surfaced, never dropped");
  assert.ok(un.body.rows.some((r) => r.reason === "NO_TECHNICIAN"));
  assert.ok(un.body.rows.some((r) => r.reason === "UNRESOLVED_ALIAS"));
  assert.match(un.body.explanation, /could not be attributed/);
});

test("P1 measured worklogs beat modelled standards, and the provenance flips", async () => {
  const period = thisPeriod();
  // Real effort against 40 tickets: 20 minutes each
  const wl = [];
  for (let i = 1; i <= 40; i++) wl.push(`(${i}, ${i}, 'Fatou THIAM', 20)`);
  await query(
    `INSERT INTO sdp_fdw.request_worklogs (worklog_id, request_id, technician, time_spent_minutes)
     VALUES ${wl.join(",")}`);

  await admin.post("/api/v1/emid/import/bau");
  const { rows } = await query(
    `SELECT hours, provenance FROM bau_load
      WHERE user_id = $1 AND period = $2 AND source = 'HELPDESK'`, [F.U.contribSGO, period]);
  assert.equal(rows[0].provenance, "MEASURED", "real worklogs are measurement, not a model");
  assert.equal(Number(rows[0].hours), 13.33, "40 × 20 minutes = 13.33 h");

  const led = await admin.get(`/api/v1/reports/capacity-ledger?from=${period}&months=1`);
  const cell = led.body.rows.find((r) => r.user_id === F.U.contribSGO).periods[0];
  assert.equal(cell.data_confidence, "HIGH");
  assert.match(cell.explanation, /measured/);
});

test("P1 project commitment is expanded onto the grid and headroom goes negative honestly", async () => {
  const period = thisPeriod();
  const project = (await infLead.post("/api/v1/projects").send({
    title: "SGO LAN Refresh", lead_division_id: F.D.INF, sites: [F.S.SGO],
  })).body.project;
  // pg returns DATE as a JS Date, whose String() is "Wed Jul 31 2026 …" —
  // format it properly rather than slicing that.
  const { rows: lastDay } = await query(
    `SELECT to_char(last_day, 'YYYY-MM-DD') AS last_day FROM emid.calendar_month WHERE period = $1`,
    [period]);
  await infLead.post(`/api/v1/projects/${project.id}/allocations`).send({
    user_id: F.U.contribSGO, start_date: `${period}-01`,
    end_date: lastDay[0].last_day,
    percent: 95, role: "Lead engineer",
  });

  const led = await admin.get(`/api/v1/reports/capacity-ledger?from=${period}&months=1`);
  const cell = led.body.rows.find((r) => r.user_id === F.U.contribSGO).periods[0];
  assert.ok(cell.project_hours > 0, "project commitment converts to hours against the real denominator");
  assert.ok(cell.breakdown.some((b) => b.project === project.code));
  assert.ok(cell.headroom_hours < 0, "95% project + helpdesk load exceeds available hours");
  assert.equal(cell.status, "RED");
  assert.match(cell.explanation, new RegExp(`projects .* h \\(${project.code} 95%\\)`));
  assert.match(cell.explanation, /headroom -/);
});

test("P1 capacity status is computed, never declared, and site isolation holds", async () => {
  const period = thisPeriod();
  const led = await admin.get(`/api/v1/reports/capacity-ledger?from=${period}&months=1`);
  for (const row of led.body.rows) {
    for (const c of row.periods) {
      assert.ok(["GREEN", "AMBER", "RED", "NO_CAPACITY_DATA"].includes(c.status));
      if (c.available_hours != null && c.headroom_hours < 0) assert.equal(c.status, "RED");
    }
  }

  // A site-restricted account sees only its own site's people
  await query(`UPDATE users SET enterprise_access = false WHERE id = $1`, [F.U.contribSGO]);
  const scoped = await contribSGO.get(`/api/v1/reports/capacity-ledger?from=${period}&months=1`);
  assert.ok(scoped.body.rows.length > 0);
  assert.ok(scoped.body.rows.every((r) => r.site_code === "SGO"),
    "a site-restricted account never learns other sites' staffing");
  await query(`UPDATE users SET enterprise_access = true WHERE id = $1`, [F.U.contribSGO]);
});

test("P1 effort standards are management decisions, versioned and attributed", async () => {
  const list = await admin.get("/api/v1/effort-standards");
  assert.equal(list.status, 200);
  assert.ok(list.body.standards.length >= 30, "a standard exists for every observed category");
  assert.ok(list.body.standards.every((s) => s.rationale && s.rationale.length >= 20),
    "every standard carries a written rationale");
  assert.ok(list.body.standards.some((s) => s.placeholder),
    "seeded values are flagged as placeholders pending the named owner");

  // Superseding closes the old one rather than overwriting: past months stay reproducible
  const res = await admin.post("/api/v1/effort-standards").send({
    request_type: "Incident", category: "IT Infrastructure", minutes: 75,
    valid_from: "2026-07-01",
    rationale: "Calibrated against the first full month of worklogs — median 74 minutes across 212 incidents.",
  });
  assert.equal(res.status, 201);
  const { rows } = await query(
    `SELECT minutes, valid_from, valid_to FROM effort_standard
      WHERE request_type = 'Incident' AND category = 'IT Infrastructure' ORDER BY valid_from`);
  assert.equal(rows.length, 2);
  assert.ok(rows[0].valid_to, "the superseded standard is closed, not deleted");
  assert.equal(rows[1].minutes, 75);

  assert.equal((await infLead.post("/api/v1/effort-standards").send({
    request_type: "Incident", category: "Email", minutes: 10, valid_from: "2026-01-01",
    rationale: "A division lead should not be able to change the group-wide effort model.",
  })).status, 403);
});

// ===================== PHASE 2 =====================

test("P2 department-meeting demand lands as DRAFT, unscored, and re-import never duplicates", async () => {
  await query(`INSERT INTO sdp_fdw.md_meetings (meeting_id, site_code, meeting_date, title)
               VALUES (1, 'SGO', '2026-06-10', 'Sabodala department meeting')`);
  await query(
    `INSERT INTO sdp_fdw.md_meeting_projects
       (meeting_id, ord, project_name, description, phase, it_involvement, status, it_lead, business_sponsor, target_end)
     VALUES (1, 1, 'Weighbridge integration', 'Automate truck weighing into the ERP',
             'scoping', 'lead', 'active', 'Fatou THIAM', 'Mine Manager', '2026-12-31')`);
  await query(
    `INSERT INTO sdp_fdw.md_issues (issue_id, meeting_id, site_code, title, description, status, raised_by, raised_date)
     VALUES (1, 1, 'SGO', 'Radio dead spots underground', 'Coverage gaps on level 3', 'open', 'Fatou THIAM', '2026-06-10'),
            (2, 1, 'SGO', 'Closed already', 'Should not import', 'closed', 'Fatou THIAM', '2026-05-01')`);

  const res = await admin.post("/api/v1/emid/import/demand").send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.projects, 1);
  assert.equal(res.body.issues, 1, "only the open issue imports");

  const demands = await admin.get("/api/v1/demands");
  const imported = demands.body.demands.find((d) => d.title === "Weighbridge integration");
  assert.ok(imported, "the business project is now in the funnel");
  assert.equal(imported.status, "DRAFT", "imported demand is never auto-approved");
  assert.equal(imported.business_value, null, "and never auto-scored — a human scores it");
  assert.match(imported.problem, /Business sponsor: Mine Manager/);
  assert.match(imported.problem, /Captured in the SGO meeting/);
  assert.ok(imported.requester_id, "the IT lead resolved to a real PULSE user through the identity spine");

  // Idempotence: running it twice changes nothing
  const again = await admin.post("/api/v1/emid/import/demand").send({});
  assert.equal(again.body.imported, 0);
  assert.equal(again.body.skipped, 2);
  const after = await admin.get("/api/v1/demands");
  assert.equal(after.body.demands.filter((d) => d.title === "Weighbridge integration").length, 1);
});

// ===================== PHASE 4 =====================

test("P4 the go-live control flags milestones with no change record, and respects concealment", async () => {
  const soon = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const project = (await infLead.post("/api/v1/projects").send({
    title: "Cutover project", lead_division_id: F.D.INF, sites: [F.S.SGO],
  })).body.project;
  await infLead.post(`/api/v1/projects/${project.id}/milestones`)
    .send({ title: "Production cutover", type: "GO_LIVE", due_date: soon });

  const res = await admin.get("/api/v1/controls/go-live-without-change?horizon=14");
  assert.equal(res.status, 200);
  const finding = res.body.findings.find((f) => f.project_code === project.code);
  assert.ok(finding, "an imminent go-live with no change record is flagged");
  assert.match(finding.finding, /no change record in ServiceDesk Plus/);
  assert.equal(res.body.control, "GO_LIVE_WITHOUT_CHANGE_RECORD");

  // Add a plausible change record and it stops being a finding
  await query(
    `INSERT INTO sdp_fdw.change_records (change_id, display_id, title, status, site, scheduled_start)
     VALUES (1, 'CHG-501', 'Sabodala cutover', 'Approved', 'Sabodala', $1::date)`, [soon]);
  const after = await admin.get("/api/v1/controls/go-live-without-change?horizon=14");
  assert.ok(!after.body.findings.some((f) => f.project_code === project.code),
    "a matched change record clears the finding");

  // A confidential project is counted but never named for someone who cannot see it
  const secret = (await admin.post("/api/v1/projects").send({
    title: "Secret cutover", lead_division_id: F.D.INF, confidential: true,
  })).body.project;
  await admin.post(`/api/v1/projects/${secret.id}/milestones`)
    .send({ title: "Secret go live", type: "GO_LIVE", due_date: soon });
  const viewer = await login(app, "viewer@test.local");
  const scoped = await viewer.get("/api/v1/controls/go-live-without-change?horizon=14");
  assert.ok(scoped.body.concealed_from_you >= 1, "hidden work is counted");
  assert.ok(!JSON.stringify(scoped.body).includes("Secret cutover"), "but never named");
});

test("P4 the tracker's heaviest activity is computed from PULSE, and silent sites are named", async () => {
  const year = new Date().getUTCFullYear();
  // The control counts ACTIVE initiatives, so IDEA-stage work is excluded by
  // design. Move one Sabodala project into INITIATION so it counts.
  const sgo = (await admin.get("/api/v1/projects")).body.projects
    .find((p) => p.title === "SGO LAN Refresh");
  const fresh = (await admin.get(`/api/v1/projects/${sgo.id}`)).body.project;
  await admin.put(`/api/v1/projects/${sgo.id}`).send({
    stage: "INITIATION", description: "Refresh the Sabodala local network",
    sponsor: "CIO", roadmap_pillar: "Network", updated_at: fresh.updated_at,
  });

  const res = await admin.get(`/api/v1/controls/tracker-initiatives?year=${year}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.activity, "P2-ITPROJECTINITIATIVES");
  assert.equal(res.body.weight, 0.165);
  assert.ok(res.body.rows.some((r) => r.site_code === "SGO" && r.pulse_projects > 0),
    "PULSE knows how many projects are actually running at Sabodala");
  assert.ok(res.body.silent_sites.includes("SGO") || res.body.rows.some((r) => r.status === "NOT_REPORTED"),
    "a site with active projects that reported nothing is named");
  assert.match(res.body.note, /never writes into the SDP database/);
});

test("P4 inspection findings become risks, and external actions land in one list", async () => {
  await query(`INSERT INTO sdp_fdw.insp_inspections (inspection_id, site_code, inspection_date, overall_risk)
               VALUES (1, 'SGO', '2026-05-20', 'high')`);
  await query(
    `INSERT INTO sdp_fdw.insp_actions (action_id, inspection_id, site_code, finding, action, owner, due_date, status)
     VALUES (1, 1, 'SGO', 'Server room door left unlocked', 'Fit a badge reader', 'Fatou THIAM', '2026-07-01', 'open')`);
  await query(
    `INSERT INTO sdp_fdw.md_actions (action_id, meeting_id, site_code, action, owner, due_date, status)
     VALUES (1, 1, 'SGO', 'Circulate the network diagram', 'Fatou THIAM', '2026-07-15', 'open')`);

  const risks = await admin.post("/api/v1/emid/import/inspection-findings").send({});
  assert.equal(risks.status, 200);
  assert.equal(risks.body.risks, 1);
  const { rows: risk } = await query(
    `SELECT title, impact, description FROM risks WHERE title LIKE 'Server room%'`);
  assert.equal(risk.length, 1);
  assert.equal(risk[0].impact, 4, "a high-risk inspection carries a higher impact");
  assert.match(risk[0].description, /insp_actions:1/, "the source id is retained as evidence");

  const actions = await admin.post("/api/v1/emid/import/actions").send({});
  assert.equal(actions.body.imported, 2, "meeting and inspection actions both land in My Actions");
  const { rows: acts } = await query(
    `SELECT source FROM actions WHERE source IN ('DEPT_MEETING','INSPECTION')`);
  assert.equal(acts.length, 2);

  // Re-running imports nothing twice
  const again = await admin.post("/api/v1/emid/import/actions").send({});
  assert.equal(again.body.imported, 0);
  assert.equal(again.body.skipped, 2);
});

test("P4 benefits can be measured from ticket history, normalised per day", async () => {
  const res = await admin.get("/api/v1/controls/ticket-benefit?site=SGO&category=IT%20Infrastructure" +
    "&before_from=2020-01-01&before_to=2020-01-31&after_from=2020-02-01&after_to=2020-02-29");
  assert.equal(res.status, 200);
  assert.equal(res.body.control, "TICKET_BASED_BENEFIT");
  assert.match(res.body.explanation, /human judgement|baseline window/);
});

// ===================== SAFETY =====================

test("SAFETY the link is one-way: PULSE holds no write path into the SDP schema", async () => {
  // Every module that touches SDP goes through these files. None may contain a
  // write statement against sdp_fdw — this is the §3.3 constraint as a test.
  const fs = require("fs");
  const path = require("path");
  const files = [
    "src/modules/emid/service.js", "src/modules/emid/controls.js",
    "src/modules/emid/demandImport.js", "src/modules/resources/ledger.js",
    "src/jobs/bauImport.js",
  ];
  for (const f of files) {
    const src = fs.readFileSync(path.join(__dirname, "..", "..", f), "utf8");
    const writes = src.match(/(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+sdp_fdw\./gi);
    assert.equal(writes, null, `${f} must never write to sdp_fdw (found: ${writes})`);
  }

  // And the mart views are read-only derivations by construction
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM pg_matviews WHERE schemaname = 'mart'`);
  assert.ok(rows[0].n >= 3, "the mart is materialised views, not tables PULSE writes through");
});

test("SAFETY with SDP unreachable the capacity view still renders from the local copy", async () => {
  const period = thisPeriod();
  // Simulate the source being gone: rename the schema out of the way
  await query(`ALTER SCHEMA sdp_fdw RENAME TO sdp_fdw_offline`);
  try {
    const led = await admin.get(`/api/v1/reports/capacity-ledger?from=${period}&months=1`);
    assert.equal(led.status, 200, "the ledger renders with the source offline");
    const cell = led.body.rows.find((r) => r.user_id === F.U.contribSGO).periods[0];
    assert.ok(cell.helpdesk_tickets > 0, "from the last imported copy");
    assert.ok(led.body.as_of, "with a visible 'as of' stamp so stale is not mistaken for current");

    // And the import says so honestly rather than pretending
    const imp = await admin.post("/api/v1/emid/import/bau");
    assert.equal(imp.status, 503);
    assert.equal(imp.body.code, "BLOCKED_EXTERNAL");
    assert.match(imp.body.note, /last imported copy/);

    const cov = await admin.get("/api/v1/emid/coverage");
    assert.equal(cov.status, 503);
    assert.equal(cov.body.code, "BLOCKED_EXTERNAL");

    const dem = await admin.post("/api/v1/emid/import/demand").send({});
    assert.equal(dem.status, 503);
  } finally {
    await query(`ALTER SCHEMA sdp_fdw_offline RENAME TO sdp_fdw`);
  }
});

test("ACCEPTANCE 10.3 every active person has a capacity row for the current month", async () => {
  await admin.post("/api/v1/person-capacity/seed").send({ periods: [thisPeriod()] });
  const { rows } = await query(
    `SELECT u.id, u.name FROM users u
       LEFT JOIN person_capacity c ON c.user_id = u.id AND c.period = to_char(now(),'YYYY-MM')
                                  AND c.deleted_at IS NULL
      WHERE u.active AND u.deleted_at IS NULL AND u.role <> 'VIEWER' AND c.id IS NULL`);
  assert.equal(rows.length, 0,
    `every active person needs a capacity row, missing: ${rows.map((r) => r.name).join(", ")}`);
});
