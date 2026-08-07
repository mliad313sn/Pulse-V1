"use strict";
const { query, withTransaction } = require("../../db/pool");
const audit = require("../../middleware/audit");
const { badRequest, conflict, notFound, forbidden } = require("../../middleware/errors");
const rag = require("../rag/service");
const notifications = require("../notifications/service");
const gates = require("./gates");

// ===== code generation: PRJ-{YYYY}-{NNN} from sequences row locked FOR UPDATE =====
async function nextProjectCode(client) {
  const year = new Date().getUTCFullYear();
  const seqName = `project_code_${year}`;
  await client.query(
    `INSERT INTO sequences (name, next_value) VALUES ($1, 1) ON CONFLICT (name) DO NOTHING`,
    [seqName]
  );
  const { rows } = await client.query(
    `SELECT id, next_value FROM sequences WHERE name = $1 FOR UPDATE`,
    [seqName]
  );
  const n = rows[0].next_value;
  await client.query(`UPDATE sequences SET next_value = next_value + 1, updated_at = now() WHERE id = $1`, [rows[0].id]);
  return `PRJ-${year}-${String(n).padStart(3, "0")}`;
}

async function assertValidPM(db, pmId) {
  if (pmId == null) return;
  const { rows } = await db.query(
    `SELECT role, active FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [pmId]
  );
  if (!rows[0] || !rows[0].active) throw badRequest("Project manager must be an active user");
  if (rows[0].role === "VIEWER") throw badRequest("A Viewer cannot be assigned as project manager");
}

function assertOverrideValid(ragOverride, reason) {
  if (ragOverride != null && (typeof reason !== "string" || reason.trim().length < 30)) {
    throw badRequest("RAG override requires a reason of at least 30 characters");
  }
}

const PROJECT_FIELDS = [
  "title", "description", "lead_division_id", "project_manager_id", "sponsor", "stage",
  "priority", "start_date", "target_date", "actual_end_date", "budget_note",
  "roadmap_pillar", "confidential", "rag_override", "rag_override_reason", "exec_commentary",
];

async function createProject(actor, input) {
  assertOverrideValid(input.rag_override, input.rag_override_reason);
  return withTransaction(async (client) => {
    await assertValidPM(client, input.project_manager_id);
    const code = await nextProjectCode(client);
    const { rows } = await client.query(
      `INSERT INTO projects (code, title, description, lead_division_id, project_manager_id, sponsor,
         stage, priority, start_date, target_date, budget_note, roadmap_pillar, confidential,
         rag_override, rag_override_reason, exec_commentary, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        code, input.title, input.description || null, input.lead_division_id,
        input.project_manager_id || null, input.sponsor || null,
        input.stage || "IDEA", input.priority || "P2",
        input.start_date || null, input.target_date || null,
        input.budget_note || null, input.roadmap_pillar || null,
        input.confidential === true, input.rag_override || null,
        input.rag_override_reason || null, input.exec_commentary || null, actor.id,
      ]
    );
    const project = rows[0];

    // divisions: lead + engaged/consulted
    const divisions = input.divisions || [];
    if (!divisions.some((d) => d.division_id === input.lead_division_id && d.role_in_project === "LEAD")) {
      divisions.unshift({ division_id: input.lead_division_id, role_in_project: "LEAD" });
    }
    for (const d of divisions) {
      await client.query(
        `INSERT INTO project_divisions (project_id, division_id, role_in_project, created_by)
         VALUES ($1,$2,$3,$4) ON CONFLICT (project_id, division_id) DO NOTHING`,
        [project.id, d.division_id, d.role_in_project, actor.id]
      );
    }
    for (const siteId of input.sites || []) {
      await client.query(
        `INSERT INTO project_sites (project_id, site_id, created_by)
         VALUES ($1,$2,$3) ON CONFLICT (project_id, site_id) DO NOTHING`,
        [project.id, siteId, actor.id]
      );
    }

    await audit.recordCreate(client, "project", project.id, actor.id);
    if (project.project_manager_id) {
      await notifications.create(client, {
        userId: project.project_manager_id, type: "PM_ASSIGNED",
        entity: "project", entityId: project.id,
        text: `You are now project manager of ${project.code} ${project.title}`,
        createdBy: actor.id,
      });
    }
    await rag.recomputeProject(client, project.id, actor.id);
    return project;
  });
}

// Optimistic locking: expectedUpdatedAt must match or 409 with the current record.
async function updateProject(actor, projectAccess, patch, expectedUpdatedAt) {
  const { project, access } = projectAccess;
  if (access !== "FULL") throw forbidden("Full edit rights required on this project");
  if (patch.confidential !== undefined && actor.role !== "ADMIN") {
    throw forbidden("Only Admin can change the confidential flag");
  }
  if (!expectedUpdatedAt) throw badRequest("updated_at (as last read) is required");

  const after = { ...project };
  for (const f of PROJECT_FIELDS) if (patch[f] !== undefined) after[f] = patch[f];
  assertOverrideValid(after.rag_override, after.rag_override_reason);
  if (after.rag_override == null) after.rag_override_reason = null;
  if (patch.project_manager_id !== undefined && patch.project_manager_id !== project.project_manager_id) {
    await assertValidPM({ query }, patch.project_manager_id);
  }

  // ITPM360 stage gate: changing stage must follow the state machine (no skipping)
  if (after.stage !== project.stage) {
    const [msCount, goLive] = await Promise.all([
      query(`SELECT count(*)::int AS n FROM milestones WHERE project_id = $1 AND deleted_at IS NULL`, [project.id]),
      query(`SELECT count(*)::int AS n FROM milestones WHERE project_id = $1 AND deleted_at IS NULL
              AND type = 'GO_LIVE' AND status = 'DONE'`, [project.id]),
    ]);
    const verdict = gates.checkTransition(project.stage, after.stage, after,
      { milestoneCount: msCount.rows[0].n, goLiveDone: goLive.rows[0].n > 0 }, actor);
    if (!verdict.ok) {
      // steering-committee gate failure is an authorization problem, not a data problem
      const scUnmet = (verdict.unmet || []).some((r) => r.label.includes("Steering Committee"));
      throw scUnmet ? forbidden(verdict.error) : badRequest(verdict.error);
    }
  }

  return withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE projects SET
         title=$3, description=$4, lead_division_id=$5, project_manager_id=$6, sponsor=$7,
         stage=$8, priority=$9, start_date=$10, target_date=$11, actual_end_date=$12,
         budget_note=$13, roadmap_pillar=$14, confidential=$15, rag_override=$16,
         rag_override_reason=$17, exec_commentary=$18, updated_at=now()
       WHERE id=$1 AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $2::timestamptz) AND deleted_at IS NULL
       RETURNING *`,
      [
        project.id, expectedUpdatedAt,
        after.title, after.description, after.lead_division_id, after.project_manager_id,
        after.sponsor, after.stage, after.priority, after.start_date, after.target_date,
        after.actual_end_date, after.budget_note, after.roadmap_pillar, after.confidential,
        after.rag_override, after.rag_override_reason, after.exec_commentary,
      ]
    );
    if (res.rows.length === 0) {
      const cur = await client.query(`SELECT * FROM projects WHERE id=$1 AND deleted_at IS NULL`, [project.id]);
      if (!cur.rows[0]) throw notFound("Project not found");
      throw conflict("This project changed since you loaded it — review and retry", { current: cur.rows[0] });
    }
    await audit.record(client, {
      entity: "project", entityId: project.id, userId: actor.id,
      changes: audit.diff(project, after, PROJECT_FIELDS),
    });
    if (after.stage !== project.stage) {
      await client.query(
        `INSERT INTO stage_transitions (project_id, from_stage, to_stage, approved_by, note)
         VALUES ($1,$2,$3,$4,$5)`,
        [project.id, project.stage, after.stage, actor.id, patch.stage_note || null]
      );
    }
    if (
      patch.project_manager_id !== undefined &&
      patch.project_manager_id !== project.project_manager_id &&
      patch.project_manager_id != null
    ) {
      await notifications.create(client, {
        userId: patch.project_manager_id, type: "PM_ASSIGNED",
        entity: "project", entityId: project.id,
        text: `You are now project manager of ${project.code} ${after.title}`,
        createdBy: actor.id,
      });
    }
    await rag.recomputeProject(client, project.id, actor.id);
    const fresh = await client.query(`SELECT * FROM projects WHERE id=$1`, [project.id]);
    return fresh.rows[0];
  });
}

// membership (divisions/sites) updates — FULL access only
async function setMembership(actor, projectAccess, { divisions, sites }) {
  const { project, access } = projectAccess;
  if (access !== "FULL") throw forbidden("Full edit rights required on this project");
  return withTransaction(async (client) => {
    if (divisions) {
      await client.query(`UPDATE project_divisions SET deleted_at = now() WHERE project_id = $1 AND deleted_at IS NULL`, [project.id]);
      for (const d of divisions) {
        await client.query(
          `INSERT INTO project_divisions (project_id, division_id, role_in_project, created_by)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (project_id, division_id) DO UPDATE SET role_in_project = $3, deleted_at = NULL, updated_at = now()`,
          [project.id, d.division_id, d.role_in_project, actor.id]
        );
      }
      await audit.record(client, {
        entity: "project", entityId: project.id, userId: actor.id,
        changes: [{ field: "divisions", old: null, new: divisions.map((d) => `${d.division_id}:${d.role_in_project}`).join(",") }],
      });
    }
    if (sites) {
      await client.query(`UPDATE project_sites SET deleted_at = now() WHERE project_id = $1 AND deleted_at IS NULL`, [project.id]);
      for (const siteId of sites) {
        await client.query(
          `INSERT INTO project_sites (project_id, site_id, created_by) VALUES ($1,$2,$3)
           ON CONFLICT (project_id, site_id) DO UPDATE SET deleted_at = NULL, updated_at = now()`,
          [project.id, siteId, actor.id]
        );
      }
      await audit.record(client, {
        entity: "project", entityId: project.id, userId: actor.id,
        changes: [{ field: "sites", old: null, new: sites.join(",") }],
      });
    }
    await rag.recomputeProject(client, project.id, actor.id);
  });
}

async function softDeleteProject(actor, projectId) {
  if (actor.role !== "ADMIN") throw forbidden("Only Admin can delete");
  await withTransaction(async (client) => {
    await client.query(`UPDATE projects SET deleted_at = now(), updated_at = now() WHERE id = $1`, [projectId]);
    await audit.recordDelete(client, "project", projectId, actor.id);
  });
}

// Confidentiality visibility clause for list queries.
// Contributors/Viewers never see confidential projects — except a Contributor who IS the PM.
function confidentialityWhere(user, params) {
  const clauses = [];
  if (!(user.role === "ADMIN" || user.role === "DIVISION_LEAD")) {
    params.push(user.id);
    clauses.push(`(p.confidential = false OR p.project_manager_id = $${params.length})`);
  }
  // OpsPm360 site isolation: no enterprise access -> only projects touching own site (or own PM projects)
  if (user.enterprise_access === false) {
    params.push(user.site_id || -1, user.id);
    clauses.push(`(EXISTS (SELECT 1 FROM project_sites psi WHERE psi.project_id = p.id
                    AND psi.deleted_at IS NULL AND psi.site_id = $${params.length - 1})
                  OR p.project_manager_id = $${params.length})`);
  }
  return clauses.length ? clauses.join(" AND ") : "TRUE";
}

// ===== portfolio list with filters (plan §4.1); card data in one query =====
async function listPortfolio(user, filters = {}) {
  const params = [];
  const where = ["p.deleted_at IS NULL", confidentialityWhere(user, params)];

  if (filters.division) {
    params.push(filters.division);
    where.push(`EXISTS (SELECT 1 FROM project_divisions pd JOIN divisions d ON d.id = pd.division_id
                 WHERE pd.project_id = p.id AND pd.deleted_at IS NULL AND d.code = $${params.length})`);
  }
  if (filters.site) {
    params.push(filters.site);
    where.push(`EXISTS (SELECT 1 FROM project_sites ps JOIN sites s ON s.id = ps.site_id
                 WHERE ps.project_id = p.id AND ps.deleted_at IS NULL AND s.code = $${params.length})`);
  }
  if (filters.stage) { params.push(filters.stage); where.push(`p.stage = $${params.length}`); }
  if (filters.rag) { params.push(filters.rag); where.push(`coalesce(p.rag_override, p.rag_computed) = $${params.length}`); }
  if (filters.priority) { params.push(filters.priority); where.push(`p.priority = $${params.length}`); }
  if (filters.pm) { params.push(Number(filters.pm)); where.push(`p.project_manager_id = $${params.length}`); }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    where.push(`(p.title ILIKE $${params.length} OR p.code ILIKE $${params.length})`);
  }
  if (!filters.includeClosed) where.push(`p.stage <> 'CLOSED'`);

  const { rows } = await query(
    `SELECT p.id, p.code, p.title, p.stage, p.priority, p.confidential, p.exec_commentary,
            p.rag_computed, p.rag_override, p.rag_override_reason, p.rag_signals_json,
            p.progress_pct, p.target_date, p.last_activity_at, p.updated_at,
            ld.code AS lead_division_code,
            pm.id AS pm_id, pm.name AS pm_name, pm.role AS pm_role,
            (SELECT json_agg(json_build_object('code', d.code, 'role', pd.role_in_project) ORDER BY pd.role_in_project)
               FROM project_divisions pd JOIN divisions d ON d.id = pd.division_id
              WHERE pd.project_id = p.id AND pd.deleted_at IS NULL) AS divisions,
            (SELECT json_agg(s.code ORDER BY s.code)
               FROM project_sites ps JOIN sites s ON s.id = ps.site_id
              WHERE ps.project_id = p.id AND ps.deleted_at IS NULL) AS sites,
            (SELECT json_build_object('title', r.title, 'severity', r.severity)
               FROM roadblocks r
              WHERE r.project_id = p.id AND r.deleted_at IS NULL AND r.status <> 'RESOLVED'
              ORDER BY CASE r.severity WHEN 'CRITICAL' THEN 0 WHEN 'MAJOR' THEN 1 ELSE 2 END, r.due_date NULLS LAST
              LIMIT 1) AS top_roadblock,
            (SELECT json_build_object('title', m.title, 'due_date', m.due_date, 'type', m.type)
               FROM milestones m
              WHERE m.project_id = p.id AND m.deleted_at IS NULL AND m.status NOT IN ('DONE')
              ORDER BY m.due_date NULLS LAST
              LIMIT 1) AS next_milestone,
            (SELECT count(*)::int FROM roadblocks r
              WHERE r.project_id = p.id AND r.deleted_at IS NULL AND r.severity = 'CRITICAL'
                AND r.status <> 'RESOLVED') AS critical_roadblocks,
            (SELECT count(*)::int FROM actions a
              WHERE a.project_id = p.id AND a.deleted_at IS NULL AND a.status = 'OPEN'
                AND a.due_date IS NOT NULL AND a.due_date < (now() AT TIME ZONE 'utc')::date) AS overdue_actions
       FROM projects p
       JOIN divisions ld ON ld.id = p.lead_division_id
       LEFT JOIN users pm ON pm.id = p.project_manager_id
      WHERE ${where.join(" AND ")}
      ORDER BY CASE coalesce(p.rag_override, p.rag_computed) WHEN 'R' THEN 0 WHEN 'A' THEN 1 ELSE 2 END,
               p.target_date NULLS LAST
      LIMIT 500`,
    params
  );
  return rows;
}

async function getDetail(projectAccess) {
  const { project } = projectAccess;
  const pid = project.id;
  const [divisions, sites, milestones, roadblocks, actions, updates, decisions, pm] = await Promise.all([
    query(`SELECT pd.division_id, d.code, d.name, pd.role_in_project FROM project_divisions pd
             JOIN divisions d ON d.id = pd.division_id
            WHERE pd.project_id = $1 AND pd.deleted_at IS NULL`, [pid]),
    query(`SELECT ps.site_id, s.code, s.name FROM project_sites ps JOIN sites s ON s.id = ps.site_id
            WHERE ps.project_id = $1 AND ps.deleted_at IS NULL`, [pid]),
    query(`SELECT m.*, ou.name AS owner_name, cu.name AS co_owner_name, s.code AS site_code, od.code AS owner_division_code,
                  (SELECT json_agg(json_build_object('id', ri.id, 'label', ri.label, 'checked', ri.checked) ORDER BY ri.id)
                     FROM readiness_items ri WHERE ri.milestone_id = m.id AND ri.deleted_at IS NULL) AS readiness
             FROM milestones m
             LEFT JOIN users ou ON ou.id = m.owner_user_id
             LEFT JOIN users cu ON cu.id = m.co_owner_user_id
             LEFT JOIN sites s ON s.id = m.site_id
             LEFT JOIN divisions od ON od.id = m.owner_division_id
            WHERE m.project_id = $1 AND m.deleted_at IS NULL
            ORDER BY m.order_index, m.due_date NULLS LAST`, [pid]),
    query(`SELECT r.*, u.name AS owner_name, d.code AS raised_by_code,
                  (extract(epoch FROM (now() - r.created_at)) / 86400)::int AS age_days
             FROM roadblocks r
             LEFT JOIN users u ON u.id = r.owner_user_id
             LEFT JOIN divisions d ON d.id = r.raised_by_division_id
            WHERE r.project_id = $1 AND r.deleted_at IS NULL
            ORDER BY CASE r.severity WHEN 'CRITICAL' THEN 0 WHEN 'MAJOR' THEN 1 ELSE 2 END, r.created_at`, [pid]),
    query(`SELECT a.*, u.name AS owner_name FROM actions a
             LEFT JOIN users u ON u.id = a.owner_user_id
            WHERE a.project_id = $1 AND a.deleted_at IS NULL
            ORDER BY CASE a.status WHEN 'OPEN' THEN 0 ELSE 1 END, a.due_date NULLS LAST`, [pid]),
    query(`SELECT su.*, u.name AS author_name FROM status_updates su
             JOIN users u ON u.id = su.author_id
            WHERE su.project_id = $1 AND su.deleted_at IS NULL
            ORDER BY su.created_at DESC LIMIT 50`, [pid]),
    query(`SELECT dc.* FROM decisions dc
            WHERE dc.project_id = $1 AND dc.deleted_at IS NULL
            ORDER BY dc.date DESC, dc.created_at DESC LIMIT 50`, [pid]),
    project.project_manager_id
      ? query(`SELECT id, name, role, division_id, site_id FROM users WHERE id = $1`, [project.project_manager_id])
      : Promise.resolve({ rows: [] }),
  ]);
  return {
    project: { ...project, divisions: undefined, sites: undefined },
    access: projectAccess.access,
    isPM: projectAccess.isPM,
    pm: pm.rows[0] || null,
    divisions: divisions.rows,
    sites: sites.rows,
    milestones: milestones.rows,
    roadblocks: roadblocks.rows,
    actions: actions.rows,
    statusUpdates: updates.rows,
    decisions: decisions.rows,
  };
}

// ===== status updates (plan: mood + <=400 chars, 2 fields) =====
async function postStatusUpdate(actor, projectAccess, { mood, summary }) {
  const { project, access } = projectAccess;
  if (actor.role === "VIEWER" || access === "READ") {
    throw forbidden("You cannot post updates on this project");
  }
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO status_updates (project_id, author_id, mood, summary, created_by)
       VALUES ($1,$2,$3,$4,$2) RETURNING *`,
      [project.id, actor.id, mood, summary]
    );
    await audit.recordCreate(client, "status_update", rows[0].id, actor.id);
    await rag.recomputeProject(client, project.id, actor.id);
    return rows[0];
  });
}

// ===== decisions =====
async function addDecision(actor, projectAccess, { text, decidedBy, date, meetingId }) {
  const { project, access } = projectAccess;
  if (access !== "FULL") throw forbidden("Full edit rights required to log decisions");
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO decisions (project_id, meeting_id, text, decided_by, date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [project.id, meetingId || null, text, decidedBy || actor.name, date || new Date().toISOString().slice(0, 10), actor.id]
    );
    await audit.recordCreate(client, "decision", rows[0].id, actor.id);
    await rag.recomputeProject(client, project.id, actor.id);
    return rows[0];
  });
}

module.exports = {
  createProject, updateProject, setMembership, softDeleteProject,
  listPortfolio, getDetail, postStatusUpdate, addDecision,
};
