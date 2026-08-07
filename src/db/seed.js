"use strict";
// Demo seed (plan §7): RAG-boundary scenarios baked in —
//   PRJ-…-001 RED (slipped milestone + critical roadblock), PRJ-…-006 RED (silent >30d),
//   PRJ-…-008 ON_HOLD (freshness exempt), PRJ-…-009 manual override, PRJ-…-010 confidential,
//   Contributor site IT leads assigned as PMs.
// Dates are relative to "now" so the scenarios hold whenever you seed.
// Re-running: refuses if data exists unless --force (truncates everything).
const bcrypt = require("bcryptjs");
const { pool, withTransaction } = require("./pool");
const { recomputeProject } = require("../modules/rag/service");

const days = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const daysTs = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString();
};

const ADMIN_EMAIL = "admin@endeavourmining.com";
const ADMIN_PASSWORD = "ChangeMe-2026!";
const DEMO_PASSWORD = "Endeavour-2026!";

async function seed(force = false) {
  const existing = await pool.query("SELECT count(*)::int AS n FROM divisions");
  if (existing.rows[0].n > 0) {
    if (!force) {
      console.log("Database already seeded — run `npm run seed -- --force` to wipe and reseed.");
      return;
    }
    await pool.query(`TRUNCATE task_dependencies, tasks, workstreams, meeting_minutes_versions, notification_deliveries, capas, risks, sync_ops, raci_assignments, deliverables, stage_transitions, audit_log, rag_history, notifications, readiness_items, status_updates,
      decisions, actions, meeting_items, meeting_attendees, meetings, roadblocks, milestones,
      project_sites, project_divisions, projects, users, sequences, sites, divisions, session
      RESTART IDENTITY CASCADE`);
  }

  const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const demoHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  await withTransaction(async (c) => {
    // divisions & sites (plan §2 seeds)
    const divRows = [
      ["INF", "Infrastructure"], ["OPS", "Operations"], ["BAP", "Business Apps"],
      ["DAT", "Data Insight"], ["SEC", "Information Security"], ["EAR", "Enterprise Architecture"],
      ["GRP", "Group IT"],
    ];
    const D = {};
    for (const [code, name] of divRows) {
      const r = await c.query(`INSERT INTO divisions (code, name) VALUES ($1,$2) RETURNING id`, [code, name]);
      D[code] = r.rows[0].id;
    }
    const siteRows = [
      ["SGO", "Sabodala-Massawa"], ["HGO", "Houndé"], ["ITY", "Ity"], ["SML", "Sissingué"],
      ["MGO", "Mana"], ["KGO", "Kalana"], ["DKR", "Dakar Office"], ["ABJ", "Abidjan Office"],
      ["OUA", "Ouagadougou Office"], ["GROUP", "Group-wide"],
    ];
    const S = {};
    for (const [code, name] of siteRows) {
      const r = await c.query(`INSERT INTO sites (code, name) VALUES ($1,$2) RETURNING id`, [code, name]);
      S[code] = r.rows[0].id;
    }

    // users
    const U = {};
    const mkUser = async (key, name, email, role, div, site, hash, mustChange) => {
      const r = await c.query(
        `INSERT INTO users (name, email, password_hash, role, division_id, site_id, must_change_password)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [name, email, hash, role, div ? D[div] : null, site ? S[site] : null, mustChange]
      );
      U[key] = r.rows[0].id;
    };
    await mkUser("admin", "Group IT Manager", ADMIN_EMAIL, "ADMIN", "GRP", null, adminHash, true);
    await mkUser("inf", "Yao Bamba", "inf.lead@endeavourmining.com", "DIVISION_LEAD", "INF", null, demoHash, false);
    await mkUser("ops", "Omar Keita", "ops.lead@endeavourmining.com", "DIVISION_LEAD", "OPS", null, demoHash, false);
    await mkUser("bap", "Kofi Mensah", "bap.lead@endeavourmining.com", "DIVISION_LEAD", "BAP", null, demoHash, false);
    await mkUser("dat", "Nadia Sylla", "dat.lead@endeavourmining.com", "DIVISION_LEAD", "DAT", null, demoHash, false);
    await mkUser("sec", "Fatou Ndiaye", "sec.lead@endeavourmining.com", "DIVISION_LEAD", "SEC", null, demoHash, false);
    await mkUser("ear", "Jean-Luc Koffi", "ear.lead@endeavourmining.com", "DIVISION_LEAD", "EAR", null, demoHash, false);
    await mkUser("awa", "Awa Diallo", "awa.diallo@endeavourmining.com", "CONTRIBUTOR", "OPS", "SGO", demoHash, false);
    await mkUser("ibra", "Ibrahim Traoré", "ibrahim.traore@endeavourmining.com", "CONTRIBUTOR", "OPS", "HGO", demoHash, false);
    await mkUser("sekou", "Sekou Camara", "sekou.camara@endeavourmining.com", "CONTRIBUTOR", "OPS", "ITY", demoHash, false);
    await mkUser("amina", "Aminata Sow", "aminata.sow@endeavourmining.com", "CONTRIBUTOR", "OPS", "MGO", demoHash, false);
    await mkUser("moussa", "Moussa Ouédraogo", "moussa.ouedraogo@endeavourmining.com", "CONTRIBUTOR", "OPS", "KGO", demoHash, false);
    await mkUser("leila", "Leila Touré", "leila.toure@endeavourmining.com", "CONTRIBUTOR", "OPS", "SML", demoHash, false);
    await mkUser("marie", "Marie Kouassi", "marie.kouassi@endeavourmining.com", "CONTRIBUTOR", "DAT", "DKR", demoHash, false);
    await mkUser("viewer", "CIO Office", "cio@endeavourmining.com", "VIEWER", "GRP", null, demoHash, false);
    // ecosystem: steering committee flags + a site-isolated demo account
    await c.query(`UPDATE users SET is_steering_committee = true WHERE id IN ($1, $2)`, [U.admin, U.bap]);
    await mkUser("sgoViewer", "SGO Site Office", "sgo.office@endeavourmining.com", "VIEWER", "OPS", "SGO", demoHash, false);
    await c.query(`UPDATE users SET enterprise_access = false WHERE id = $1`, [U.sgoViewer]);

    // sequence
    const year = new Date().getUTCFullYear();
    await c.query(`INSERT INTO sequences (name, next_value) VALUES ($1, 11)`, [`project_code_${year}`]);

    // ===== projects =====
    const P = {};
    const mkProject = async (key, n, fields) => {
      const code = `PRJ-${year}-${String(n).padStart(3, "0")}`;
      const r = await c.query(
        `INSERT INTO projects (code, title, description, lead_division_id, project_manager_id, sponsor,
           stage, priority, start_date, target_date, roadmap_pillar, confidential,
           rag_override, rag_override_reason, exec_commentary, created_by, created_at, updated_at,
           operating_status, hold_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17,$18,$19) RETURNING id`,
        [
          code, fields.title, fields.description || null, D[fields.lead], fields.pm ? U[fields.pm] : null,
          fields.sponsor || "Group IT Manager", fields.stage, fields.priority,
          fields.start, fields.target, fields.pillar || "Network", fields.confidential === true,
          fields.override || null, fields.overrideReason || null, fields.exec || null,
          U.admin, fields.createdAt || daysTs(-120),
          fields.opStatus || "IN_PROGRESS", fields.holdReason || null,
        ]
      );
      P[key] = r.rows[0].id;
      const divs = [[fields.lead, "LEAD"], ...(fields.engaged || []).map((d) => [d, "ENGAGED"])];
      for (const [d, role] of divs) {
        await c.query(
          `INSERT INTO project_divisions (project_id, division_id, role_in_project, created_by) VALUES ($1,$2,$3,$4)`,
          [P[key], D[d], role, U.admin]
        );
      }
      for (const s of fields.sites || []) {
        await c.query(`INSERT INTO project_sites (project_id, site_id, created_by) VALUES ($1,$2,$3)`, [P[key], S[s], U.admin]);
      }
      return P[key];
    };

    // 001 — RED: slipped milestone + open CRITICAL roadblock + overdue action. PM = Contributor (Awa, SGO).
    await mkProject("lan", 1, {
      title: "SGO LAN Refresh", lead: "INF", engaged: ["OPS", "SEC"], sites: ["SGO"],
      stage: "EXECUTION", priority: "P1", pm: "awa", start: days(-150), target: days(40),
      exec: "SGO backbone is 20 years old and drops daily at shift change. This refresh removes the single point of failure before the wet season. One risk matters: the core switch is in customs — cleared within 2 weeks or go-live slips a month.",
      description: "Full replacement of the SGO campus LAN: core switches, access layer, fibre backbone and UPS.",
    });
    // 002 — AMBER: overdue actions
    await mkProject("erp", 2, {
      title: "Group ERP Upgrade R2", lead: "BAP", engaged: ["INF", "OPS", "DAT"],
      sites: ["GROUP", "SGO", "HGO", "ITY", "SML", "MGO", "KGO"],
      stage: "PLANNING", priority: "P1", pm: "bap", start: days(-90), target: days(175),
      exec: "ERP R2 unlocks consolidated month-end close across all sites.",
      description: "Upgrade of the group ERP to release R2 with site rollouts.", pillar: "BizPartnering",
    });
    // 003 — GREEN with GO_LIVE inside 30 days. PM = Contributor (Ibrahim, HGO).
    await mkProject("wan", 3, {
      title: "HGO Backup WAN Link", lead: "INF", engaged: ["OPS"], sites: ["HGO"],
      stage: "DEPLOYMENT", priority: "P2", pm: "ibra", start: days(-100), target: days(14),
      exec: "Removes the single WAN path at HGO ahead of the wet season.",
      description: "Secondary WAN link with automatic failover at Houndé.",
    });
    // 004 — AMBER: major roadblock
    await mkProject("soc", 4, {
      title: "SOC Onboarding Wave 2", lead: "SEC", engaged: ["INF", "OPS"], sites: ["ITY", "SML"],
      stage: "EXECUTION", priority: "P1", pm: "sec", start: days(-80), target: days(55), pillar: "Risk",
      description: "Onboarding ITY and SML into the managed SOC: sensors, log forwarding, runbooks.",
    });
    // 005 — GREEN
    await mkProject("lake", 5, {
      title: "BI Datalake Phase 2", lead: "DAT", engaged: ["BAP"], sites: ["GROUP"],
      stage: "EXECUTION", priority: "P2", pm: "marie", start: days(-70), target: days(85),
      description: "Ingestion pipelines and governed marts for production analytics.", pillar: "BizPartnering",
    });
    // 006 — RED via silence: all writes >30 days ago. PM = Contributor (Sekou, ITY).
    await mkProject("wifi", 6, {
      title: "ITY Camp Wi-Fi Extension", lead: "OPS", engaged: ["INF"], sites: ["ITY"],
      stage: "EXECUTION", priority: "P3", pm: "sekou", start: days(-120), target: days(25),
      createdAt: daysTs(-120),
      description: "Extending camp Wi-Fi coverage to accommodation blocks B and C.", pillar: "People",
    });
    // 007 — AMBER: schedule (1 of 4 milestones slipped = 25%>20% would be RED; use 1/5=20% => A)
    await mkProject("mgoerp", 7, {
      title: "MGO ERP Site Rollout", lead: "BAP", engaged: ["OPS"], sites: ["MGO"],
      stage: "DEPLOYMENT", priority: "P1", pm: "amina", start: days(-60), target: days(20),
      description: "ERP cutover for Mana: data migration, training, site readiness.", pillar: "BizPartnering",
    });
    // 008 — ON_HOLD: freshness exempt even though silent
    await mkProject("ea", 8, {
      title: "EA Reference Architecture", lead: "EAR", engaged: ["GRP"], sites: ["GROUP"],
      stage: "PLANNING", opStatus: "ON_HOLD", holdReason: "Paused pending budget review Q4", priority: "P3", pm: "ear", start: days(-200), target: null,
      createdAt: daysTs(-200),
      description: "Target-state reference architecture. Paused pending budget review.", pillar: "Other",
    });
    // 009 — manual override (computed G, overridden A with >=30 char reason)
    await mkProject("kgo", 9, {
      title: "KGO Site IT Build-out", lead: "INF", engaged: ["OPS", "SEC"], sites: ["KGO"],
      stage: "EXECUTION", priority: "P1", pm: "moussa", start: days(-45), target: days(115),
      override: "A", overrideReason: "Rack delivery re-baselined with vendor; schedule risk contained pending week-33 confirmation.",
      description: "Green-field IT build for Kalana: server room, LAN, WAN, EUC.",
    });
    // 010 — confidential (Admin-only visibility for non-leads)
    await mkProject("dash", 10, {
      title: "Executive Cost Dashboard", lead: "DAT", engaged: ["GRP"], sites: ["GROUP", "DKR"],
      stage: "PLANNING", priority: "P2", pm: "dat", start: days(-30), target: days(145),
      confidential: true, pillar: "BizPartnering",
      description: "Confidential: consolidated IT cost dashboard for ExCo.",
    });

    // ===== milestones =====
    const mkMs = async (proj, title, type, owner, coOwner, site, due, status, doneDate, ts) => {
      const r = await c.query(
        `INSERT INTO milestones (project_id, title, type, owner_division_id, owner_user_id, co_owner_user_id,
           site_id, due_date, status, done_date, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING id`,
        [
          P[proj], title, type, owner ? D[owner] : null, coOwner ? U[coOwner] : null, null,
          site ? S[site] : null, due, status, doneDate || null, U.admin, ts || daysTs(-10),
        ]
      );
      return r.rows[0].id;
    };

    // 001: 5 milestones — 2 DONE, 1 SLIPPED (=> 20%? 1/5=20% A... need RED via >20%: critical roadblock gives R anyway)
    await mkMs("lan", "Site survey & audit", "STANDARD", "INF", "awa", "SGO", days(-100), "DONE", days(-100));
    await mkMs("lan", "Firewall rules review", "SECURITY_GATE", "SEC", "sec", "SGO", days(-45), "DONE", days(-46));
    await mkMs("lan", "Core switch staging", "STANDARD", "INF", "inf", "SGO", days(-9), "SLIPPED");
    const readyMs = await mkMs("lan", "SGO cutover readiness", "SITE_READINESS", "OPS", "awa", "SGO", days(22), "IN_PROGRESS");
    await mkMs("lan", "Production cutover", "GO_LIVE", "INF", "inf", "SGO", days(40), "NOT_STARTED");
    // readiness checklist 4/6
    const labels = ["Power available", "Rack space", "LAN ready", "Local hands identified", "Access badge", "Change window agreed"];
    for (let i = 0; i < labels.length; i++) {
      await c.query(
        `INSERT INTO readiness_items (milestone_id, label, checked, checked_by, checked_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [readyMs, labels[i], i < 4, i < 4 ? U.awa : null, i < 4 ? daysTs(-5) : null, U.admin]
      );
    }

    await mkMs("erp", "Solution design sign-off", "STANDARD", "BAP", "bap", null, days(22), "IN_PROGRESS");
    await mkMs("erp", "Data model freeze", "STANDARD", "DAT", "dat", null, days(50), "NOT_STARTED");
    await mkMs("erp", "Security review", "SECURITY_GATE", "SEC", "sec", null, days(70), "NOT_STARTED");

    await mkMs("wan", "Link commissioning", "STANDARD", "INF", "inf", "HGO", days(-20), "DONE", days(-21));
    await mkMs("wan", "Failover configuration", "STANDARD", "INF", "inf", "HGO", days(-6), "DONE", days(-6));
    await mkMs("wan", "Failover test — go-live", "GO_LIVE", "INF", "ibra", "HGO", days(12), "IN_PROGRESS");

    await mkMs("soc", "ITY sensors deployed", "STANDARD", "SEC", "sec", "ITY", days(-15), "DONE", days(-15));
    await mkMs("soc", "SML sensors deployed", "SECURITY_GATE", "SEC", "leila", "SML", days(30), "IN_PROGRESS");
    await mkMs("soc", "Runbook UAT", "UAT", "SEC", "sec", null, days(45), "NOT_STARTED");

    await mkMs("lake", "Ingestion pipeline UAT", "UAT", "DAT", "marie", null, days(15), "IN_PROGRESS");
    await mkMs("lake", "Production marts live", "GO_LIVE", "DAT", "marie", null, days(80), "NOT_STARTED");

    // 006 silent: milestones exist, all writes backdated >30d
    await mkMs("wifi", "AP mounting — block B", "STANDARD", "OPS", "sekou", "ITY", days(-40), "DONE", days(-40), daysTs(-40));
    await mkMs("wifi", "AP mounting — block C", "STANDARD", "OPS", "sekou", "ITY", days(4), "IN_PROGRESS", null, daysTs(-35));

    // 007: 5 milestones, exactly 1 slipped (20% => Amber schedule)
    await mkMs("mgoerp", "Master data extract", "STANDARD", "BAP", "bap", "MGO", days(-30), "DONE", days(-30));
    await mkMs("mgoerp", "Data migration dry-run", "STANDARD", "BAP", "amina", "MGO", days(-8), "SLIPPED");
    const mgoReady = await mkMs("mgoerp", "MGO cutover readiness", "SITE_READINESS", "OPS", "amina", "MGO", days(13), "IN_PROGRESS");
    for (let i = 0; i < labels.length; i++) {
      await c.query(
        `INSERT INTO readiness_items (milestone_id, label, checked, checked_by, checked_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [mgoReady, labels[i], i < 2, i < 2 ? U.amina : null, i < 2 ? daysTs(-3) : null, U.admin]
      );
    }
    await mkMs("mgoerp", "Super-user training", "STANDARD", "OPS", "amina", "MGO", days(16), "NOT_STARTED");
    await mkMs("mgoerp", "ERP cutover", "GO_LIVE", "BAP", "bap", "MGO", days(20), "NOT_STARTED");

    await mkMs("ea", "Current-state assessment", "STANDARD", "EAR", "ear", null, days(-150), "DONE", days(-150), daysTs(-150));
    await mkMs("kgo", "Server room design", "STANDARD", "INF", "inf", "KGO", days(-10), "DONE", days(-10));
    await mkMs("kgo", "Server room readiness", "SITE_READINESS", "OPS", "moussa", "KGO", days(26), "IN_PROGRESS");
    await mkMs("dash", "KPI catalogue agreed", "STANDARD", "DAT", "dat", null, days(26), "IN_PROGRESS");

    // ===== roadblocks =====
    const mkRb = async (proj, title, sev, owner, raisedBy, due, status, ts) => {
      const r = await c.query(
        `INSERT INTO roadblocks (project_id, title, description, severity, owner_user_id, raised_by_division_id,
           due_date, status, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING id`,
        [P[proj], title, null, sev, U[owner], D[raisedBy], due, status, U.admin, ts || daysTs(-19)]
      );
      return r.rows[0].id;
    };
    const customsRb = await mkRb("lan", "Core switch stuck in Abidjan customs", "CRITICAL", "inf", "INF", days(-5), "OPEN");
    await mkRb("lan", "Fiber patch panel mislabeled in row B", "MINOR", "awa", "OPS", days(16), "IN_PROGRESS");
    await mkRb("erp", "Vendor SoW pending legal review", "MAJOR", "bap", "BAP", days(10), "IN_PROGRESS");
    await mkRb("soc", "Log forwarder sizing at SML", "MAJOR", "sec", "SEC", days(23), "OPEN");
    await mkRb("mgoerp", "Training room availability", "MINOR", "amina", "OPS", days(8), "OPEN");
    await mkRb("kgo", "Rack delivery lead time", "MINOR", "moussa", "OPS", days(55), "IN_PROGRESS");

    // ===== actions =====
    const mkAct = async (proj, title, owner, due, status, source, rbId, ts) => {
      await c.query(
        `INSERT INTO actions (project_id, title, owner_user_id, due_date, status, done_date, source, roadblock_id,
           created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
        [proj ? P[proj] : null, title, U[owner], due, status,
         status === "DONE" ? due : null, source, rbId || null, U.admin, ts || daysTs(-12)]
      );
    };
    await mkAct("lan", "Chase customs broker for revised clearance docs", "inf", days(-2), "OPEN", "ROADBLOCK", customsRb);
    await mkAct("lan", "Book SGO change window with mine planning", "awa", days(9), "OPEN", "PROJECT");
    await mkAct("lan", "Pre-stage config on loaner switch", "awa", days(12), "OPEN", "PROJECT");
    await mkAct("erp", "Confirm interface inventory with sites", "bap", days(-4), "OPEN", "PROJECT");
    await mkAct("erp", "Nominate site super-users", "ops", days(-1), "OPEN", "PROJECT");
    await mkAct("wan", "Confirm Ops on-site cover for failover window", "ibra", days(6), "OPEN", "PROJECT");
    await mkAct("soc", "Size log forwarder for SML volumes", "sec", days(11), "OPEN", "PROJECT");
    await mkAct("mgoerp", "Load MGO master data extract", "amina", days(5), "OPEN", "PROJECT");
    await mkAct("mgoerp", "Resolve training room double-booking", "amina", days(-3), "OPEN", "PROJECT");
    await mkAct("wifi", "Publish Wi-Fi heatmap survey results", "sekou", days(-36), "OPEN", "PROJECT", null, daysTs(-36));
    await mkAct(null, "Draft Q4 IT townhall agenda", "admin", days(18), "OPEN", "MEETING");

    // ===== status updates =====
    const mkSu = async (proj, author, mood, summary, ts) => {
      await c.query(
        `INSERT INTO status_updates (project_id, author_id, mood, summary, date, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5::date,$2,$5,$5)`,
        [P[proj], U[author], mood, summary, ts]
      );
    };
    await mkSu("lan", "awa", "AT_RISK", "Switch still blocked in customs; staging replanned on loaner hardware. Go-live holds only if cleared within two weeks.", daysTs(-2));
    await mkSu("lan", "awa", "WATCH", "Security gate passed. Customs lead time now the only critical-path item.", daysTs(-16));
    await mkSu("erp", "bap", "ON_TRACK", "Design workshops complete for finance and supply chain; sign-off scheduled.", daysTs(-6));
    await mkSu("wan", "ibra", "ON_TRACK", "Failover config done, test window agreed with mine planning.", daysTs(-4));
    await mkSu("soc", "sec", "WATCH", "ITY complete. SML sensor sizing under review with vendor.", daysTs(-8));
    await mkSu("lake", "marie", "ON_TRACK", "Ingestion pipelines in UAT with finance data.", daysTs(-3));
    await mkSu("mgoerp", "amina", "WATCH", "Dry-run slipped a week on master data quality; cutover date still holds.", daysTs(-5));
    await mkSu("kgo", "moussa", "ON_TRACK", "Design approved; racks on order.", daysTs(-7));
    await mkSu("dash", "dat", "ON_TRACK", "KPI catalogue drafted with Finance.", daysTs(-9));

    // ===== a closed meeting (for agenda rule c baseline) + a decision =====
    const mtg = await c.query(
      `INSERT INTO meetings (title, date, type, status, created_by, created_at, updated_at, minutes_json)
       VALUES ($1,$2,'INFRA_OPS_SYNC','CLOSED',$3,$4,$4,'{}'::jsonb) RETURNING id`,
      ["Infra ↔ Ops Weekly Sync", days(-7), U.admin, daysTs(-7)]
    );
    await c.query(
      `INSERT INTO decisions (project_id, meeting_id, text, decided_by, date, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
      [P.lan, mtg.rows[0].id, "Approve loaner-switch pre-staging to protect the go-live window.",
       "Group IT Manager", days(-7), U.admin, daysTs(-7)]
    );

    // ecosystem demo: deliverables + RACI on the LAN project
    const d1 = await c.query(
      `INSERT INTO deliverables (project_id, title, due_date, status, created_by)
       VALUES ($1,'As-built network documentation',$2,'IN_PROGRESS',$3) RETURNING id`,
      [P.lan, days(35), U.admin]
    );
    const d2 = await c.query(
      `INSERT INTO deliverables (project_id, title, due_date, status, created_by)
       VALUES ($1,'Cutover runbook (signed off)',$2,'PENDING',$3) RETURNING id`,
      [P.lan, days(30), U.admin]
    );
    const raci = [
      [d1.rows[0].id, U.awa, "R"], [d1.rows[0].id, U.inf, "A"], [d1.rows[0].id, U.sec, "C"],
      [d2.rows[0].id, U.inf, "R"], [d2.rows[0].id, U.awa, "A"], [d2.rows[0].id, U.ops, "I"],
    ];
    for (const [did, uid, role] of raci) {
      await c.query(
        `INSERT INTO raci_assignments (deliverable_id, user_id, raci_role, created_by) VALUES ($1,$2,$3,$4)`,
        [did, uid, role, U.admin]
      );
    }
    await c.query(
      `INSERT INTO stage_transitions (project_id, from_stage, to_stage, approved_by, note)
       VALUES ($1,'PLANNING','EXECUTION',$2,'Steering committee approval — design freeze reached')`,
      [P.lan, U.admin]
    );

    // recompute RAG for all projects (stores rag_computed, signals, progress, last_activity)
    for (const id of Object.values(P)) {
      await recomputeProject(c, id, U.admin);
    }

    // baseline rag_history snapshots (last 4 weeks) so trend reports have data
    for (let w = 4; w >= 1; w--) {
      await c.query(
        `INSERT INTO rag_history (project_id, snapshot_date, rag, progress_pct)
         SELECT p.id, (now() AT TIME ZONE 'utc')::date - ($1::int * 7),
                CASE WHEN p.id % 3 = 0 THEN 'A' ELSE coalesce(p.rag_override, p.rag_computed) END,
                greatest(p.progress_pct - $1 * 5, 0)
           FROM projects p WHERE p.deleted_at IS NULL AND p.stage <> 'CLOSED'
         ON CONFLICT (project_id, snapshot_date) DO NOTHING`,
        [w]
      );
    }
  });

  console.log("Seed complete.");
  console.log(`  Admin:    ${ADMIN_EMAIL} / ${ADMIN_PASSWORD} (password change forced at first login)`);
  console.log(`  Demo users (password ${DEMO_PASSWORD}):`);
  console.log("    Division leads: inf.lead@ / ops.lead@ / bap.lead@ / dat.lead@ / sec.lead@ / ear.lead@endeavourmining.com");
  console.log("    Site IT leads (Contributors, several are PMs): awa.diallo@ / ibrahim.traore@ / sekou.camara@ / aminata.sow@ / moussa.ouedraogo@ / leila.toure@endeavourmining.com");
  console.log("    Viewer: cio@endeavourmining.com");
}

if (require.main === module) {
  const force = process.argv.includes("--force");
  seed(force)
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
module.exports = { seed };
