"use strict";
// Server-side permission matrix (plan §1) — deny by default.
// PM is a per-project assignment, NOT a base role: any non-Viewer (including
// Contributor site IT leads) set as projects.project_manager_id gets FULL edit
// on that project only, keeping base-role rights everywhere else.
const { query } = require("../db/pool");
const { unauthorized, forbidden, notFound } = require("./errors");

async function loadSessionUser(req) {
  if (!req.session || !req.session.userId) return null;
  const { rows } = await query(
    `SELECT id, name, email, role, division_id, site_id, active, must_change_password,
            is_steering_committee, enterprise_access, finance_access
       FROM users WHERE id = $1 AND deleted_at IS NULL AND active = true`,
    [req.session.userId]
  );
  return rows[0] || null;
}

function requireAuth(req, res, next) {
  loadSessionUser(req)
    .then((user) => {
      if (!user) return next(unauthorized());
      // Forced first-login password change: everything except auth routes is blocked.
      if (user.must_change_password && !req.originalUrl.startsWith("/api/v1/auth/")) {
        return next(forbidden("Password change required before using PULSE"));
      }
      req.user = user;
      next();
    })
    .catch(next);
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

const isAdmin = (u) => u.role === "ADMIN";
const canCreateProject = (u) => u.role === "ADMIN" || u.role === "DIVISION_LEAD";

// Loads a project + membership rows and computes this user's access level:
//   FULL    — Admin, assigned PM, or Division Lead of the LEAD division
//   PARTIAL — Division Lead engaged/consulted; Contributor on a project touching
//             own division or own site (scoped writes only — checked per route)
//   READ    — everyone else (project visible)
// Throws 404 when the project doesn't exist OR is confidential and hidden from
// this user (hidden means invisible — same as absent, plan §1).
async function loadProjectAccess(projectId, user) {
  const { rows } = await query(
    `SELECT p.* FROM projects p WHERE p.id = $1 AND p.deleted_at IS NULL`,
    [projectId]
  );
  const project = rows[0];
  if (!project) throw notFound("Project not found");

  const [divRes, siteRes] = await Promise.all([
    query(
      `SELECT division_id, role_in_project FROM project_divisions
        WHERE project_id = $1 AND deleted_at IS NULL`,
      [projectId]
    ),
    query(
      `SELECT site_id FROM project_sites WHERE project_id = $1 AND deleted_at IS NULL`,
      [projectId]
    ),
  ]);
  project.divisions = divRes.rows;
  project.sites = siteRes.rows.map((r) => r.site_id);

  const isPM = project.project_manager_id === user.id;

  // OpsPm360 site isolation: a user without enterprise access sees ONLY projects
  // touching their own site (hidden = 404, same as absent). PM assignment wins.
  if (
    user.enterprise_access === false &&
    !isPM &&
    !(user.site_id && project.sites.includes(user.site_id))
  ) {
    throw notFound("Project not found");
  }

  // Confidential: hidden from Contributors/Viewers everywhere (§1) — except the
  // assigned PM, who must be able to run their own project.
  if (
    project.confidential &&
    (user.role === "CONTRIBUTOR" || user.role === "VIEWER") &&
    !isPM
  ) {
    throw notFound("Project not found");
  }

  let access = "READ";
  const myDivRole = project.divisions.find((d) => d.division_id === user.division_id);

  if (isAdmin(user) || isPM) {
    access = "FULL";
  } else if (user.role === "DIVISION_LEAD" && myDivRole && myDivRole.role_in_project === "LEAD") {
    access = "FULL";
  } else if (user.role === "DIVISION_LEAD" && myDivRole) {
    access = "PARTIAL"; // ENGAGED / CONSULTED
  } else if (user.role === "CONTRIBUTOR") {
    const touchesDivision = !!myDivRole;
    const touchesSite = user.site_id && project.sites.includes(user.site_id);
    if (touchesDivision || touchesSite) access = "PARTIAL";
  }

  return { project, access, isPM };
}

// Express param middleware: attaches req.projectAccess for routes with :projectId
function withProjectAccess(param = "projectId") {
  return (req, res, next) => {
    const id = Number(req.params[param]);
    if (!Number.isInteger(id) || id <= 0) return next(notFound("Project not found"));
    loadProjectAccess(id, req.user)
      .then((pa) => {
        req.projectAccess = pa;
        next();
      })
      .catch(next);
  };
}

// Item-level write rule shared by milestones/roadblocks/actions:
//  FULL project access → yes
//  Division Lead PARTIAL → item owned by own division, or owner user in own division
//  Contributor PARTIAL → item owned by self
async function canEditItem(user, projectAccess, item) {
  if (user.role === "VIEWER") return false;
  if (projectAccess.access === "FULL") return true;
  if (projectAccess.access !== "PARTIAL") return false;
  if (user.role === "DIVISION_LEAD") {
    if (item.owner_division_id && item.owner_division_id === user.division_id) return true;
    if (item.owner_user_id) {
      const { rows } = await query(
        `SELECT 1 FROM users WHERE id = $1 AND division_id = $2 AND deleted_at IS NULL`,
        [item.owner_user_id, user.division_id]
      );
      return rows.length > 0;
    }
    return false;
  }
  if (user.role === "CONTRIBUTOR") {
    return item.owner_user_id === user.id;
  }
  return false;
}

module.exports = {
  requireAuth,
  requireRole,
  isAdmin,
  canCreateProject,
  loadProjectAccess,
  withProjectAccess,
  canEditItem,
};
