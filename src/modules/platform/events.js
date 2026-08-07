"use strict";
// SPM Phase 10 — the event catalogue. These are the domain events Pulse
// emits to webhook subscribers. Payloads carry identifiers and non-sensitive
// descriptors only: a subscriber resolves detail through the API under its
// own authorization, so a webhook can never become a confidentiality or
// finance-masking bypass.
const CATALOGUE = [
  { event: "project.created", description: "A project was created",
    payload: { project_id: "bigint", code: "string", title: "string", stage: "string" } },
  { event: "project.stage_changed", description: "A project passed a lifecycle gate",
    payload: { project_id: "bigint", code: "string", from_stage: "string", to_stage: "string" } },
  { event: "project.health_changed", description: "A project's effective RAG changed",
    payload: { project_id: "bigint", code: "string", from: "R|A|G", to: "R|A|G" } },
  { event: "change_request.created", description: "A change request awaits a Steering decision",
    payload: { change_request_id: "bigint", project_id: "bigint", type: "string", title: "string" } },
  { event: "change_request.decided", description: "A change request was approved or rejected",
    payload: { change_request_id: "bigint", project_id: "bigint", decision: "APPROVED|REJECTED" } },
  { event: "demand.decided", description: "A demand was approved or rejected",
    payload: { demand_id: "bigint", decision: "APPROVED|REJECTED" } },
  { event: "meeting.closed", description: "A meeting closed and minutes were generated",
    payload: { meeting_id: "bigint", title: "string", minutes_version: "int" } },
];

const NAMES = CATALOGUE.map((e) => e.event);

module.exports = { CATALOGUE, NAMES };
