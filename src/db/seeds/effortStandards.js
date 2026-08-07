"use strict";
// PULSE ↔ SDP — the effort model, as data.
//
// One source of truth shared by migration 032 and the test harness. Every
// value is a PLACEHOLDER until the owner named in decision Q3 sets it: these
// are NOT derived from ticket data, because time_elapsed_ms is wall-clock lead
// time and modelling effort from it produces 14–20% utilisation for people
// running 50 tickets a month — wrong, and politically damaging.
const PLACEHOLDER = "Placeholder pending the effort-standard owner (Q3). Not derived from data — lead time is not effort.";

const EFFORT_STANDARDS = [
  ["Service Request", "Software and Applications", 30, PLACEHOLDER],
  ["Service Request", "ERP Support", 45, PLACEHOLDER],
  ["Service Request", "IT Infrastructure", 45, PLACEHOLDER],
  ["Service Request", "User Accounts and Access Permissions", 15, PLACEHOLDER],
  ["Service Request", "Accounts and Access", 15, PLACEHOLDER],
  ["Service Request", "Email", 20, PLACEHOLDER],
  ["Service Request", "IT Hardware and Communication Devices", 40, PLACEHOLDER],
  ["Service Request", "Network & Internet Access", 35, PLACEHOLDER],
  ["Service Request", "Printing Services", 25, PLACEHOLDER],
  ["Service Request", "Hardware and Accessories", 30, PLACEHOLDER],
  ["Service Request", "Mobile & Communication Services", 25, PLACEHOLDER],
  ["Service Request", "Employee Movements", 60, "Placeholder pending the effort-standard owner (Q3). Onboarding and offboarding are multi-step."],
  ["Service Request", "Enterprise Applications", 45, PLACEHOLDER],
  ["Service Request", "Badge d'accès site / Site Access Badge", 20, PLACEHOLDER],
  ["Service Request", "IT Administrative task", 30, PLACEHOLDER],
  ["Service Request", "IT Policy Deviation", 45, PLACEHOLDER],
  ["Service Request", "Unclassified", 30, "Placeholder pending the effort-standard owner (Q3). Median service request assumption."],

  ["Incident", "IT Infrastructure", 60, "Placeholder pending the effort-standard owner (Q3). Incidents assumed heavier than requests."],
  ["Incident", "Network & Internet Access", 60, "Placeholder pending the effort-standard owner (Q3). Incidents assumed heavier than requests."],
  ["Incident", "Software and Applications", 45, "Placeholder pending the effort-standard owner (Q3). Incidents assumed heavier than requests."],
  ["Incident", "ERP Support", 60, "Placeholder pending the effort-standard owner (Q3). Incidents assumed heavier than requests."],
  ["Incident", "IT Hardware and Communication Devices", 50, "Placeholder pending the effort-standard owner (Q3). Incidents assumed heavier than requests."],
  ["Incident", "Email", 30, "Placeholder pending the effort-standard owner (Q3). Incidents assumed heavier than requests."],
  ["Incident", "Security Issues", 90, "Placeholder pending the effort-standard owner (Q3). Security incidents require investigation."],
  ["Incident", "infosec", 90, "Placeholder pending the effort-standard owner (Q3). Security incidents require investigation."],
  ["Incident", "Unclassified", 45, "Placeholder pending the effort-standard owner (Q3). Median incident assumption."],

  ["Event", "Unclassified", 15, "Placeholder pending the effort-standard owner (Q3). Events are largely automated notifications."],
  ["Problem", "Unclassified", 120, "Placeholder pending the effort-standard owner (Q3). Problem records imply root-cause analysis."],
  ["Change", "Unclassified", 90, "Placeholder pending the effort-standard owner (Q3). Change implementation plus CAB paperwork."],
  ["Request For Information", "Unclassified", 15, "Placeholder pending the effort-standard owner (Q3). Informational responses assumed short."],
  ["Security Incident", "Unclassified", 120, "Placeholder pending the effort-standard owner (Q3). Security incidents require investigation."],
  ["Major Incident", "Unclassified", 240, "Placeholder pending the effort-standard owner (Q3). Major incidents involve multiple responders."],
  ["Periodic System Access Audit", "Periodic IT System Access Audit", 180, "Placeholder pending the effort-standard owner (Q3). Access audits are scheduled bulk work."],
  ["IT Inspection", "Inspection", 240, "Placeholder pending the effort-standard owner (Q3). A site inspection is a half-day activity."],
  ["Unclassified", "Unclassified", 30, "Placeholder pending the effort-standard owner (Q3). Applies to the 6,704 rows with no request type."],
  ["Unclassified", "IT Policy Deviation", 45, PLACEHOLDER],
];

// Idempotent insert, used by the migration and by the test harness (the
// CASCADE truncate of `users` wipes this table through its set_by FK).
async function seedEffortStandards(db, validFrom = "2026-01-01") {
  const values = EFFORT_STANDARDS.map((_, i) =>
    `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, '${validFrom}'::date, $${i * 4 + 4})`).join(",");
  const params = EFFORT_STANDARDS.flatMap(([type, cat, mins, rationale]) => [type, cat, mins, rationale]);
  await db.query(
    `INSERT INTO effort_standard (request_type, category, minutes, valid_from, rationale)
     VALUES ${values} ON CONFLICT (request_type, category, valid_from) DO NOTHING`, params);
  return EFFORT_STANDARDS.length;
}

module.exports = { EFFORT_STANDARDS, seedEffortStandards, PLACEHOLDER };
