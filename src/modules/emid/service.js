"use strict";
// PULSE ↔ SDP, PHASE 0 — alias resolution.
//
// The one rule that makes every downstream number defensible: a fuzzy match is
// a SUGGESTION, never a fact. Exact and accent-insensitive matches resolve
// automatically because they are provably the same string; anything softer is
// queued with its confidence and waits for a human, whose name and timestamp
// are recorded on the row.
//
// Nothing here ever writes to the SDP database.
const { query, withTransaction } = require("../../db/pool");
const audit = require("../../middleware/audit");
const { badRequest, notFound, forbidden, conflict } = require("../../middleware/errors");

const norm = (s) => String(s || "").trim().replace(/\s+/g, " ").toUpperCase();

// Service accounts and shared mailboxes in SDP's user list. They raise and
// close tickets but are not people, so they must never consume capacity.
const SERVICE_ACCOUNTS = new Set([
  "ABIDJAN", "HOUNDE", "MANA", "SABODALA", "ITY", "LAFIGUE", "EXPLORATION",
  "ADMINISTRATOR",
].map(norm));

// Vendors: real humans, but not Endeavour capacity.
const VENDORS = new Set(["HELP SIMPLY NETWORK"].map(norm));

// Known duplicate spellings of one human, from the dump. Seeding these stops
// the fuzzy matcher having to guess at exactly the names it would get wrong.
const KNOWN_PAIRS = [
  ["Karim Rahmatoullah", "Karim RAHMATOULLAH"],
  ["Amadou Ousmane KANOUTE", "Ousmane KANOUTE"],
  ["Ibrahim Romuald DIAKITE", "Romuald DIAKITE"],
  ["Abdou Azize SAMANDOULGOU", "Azize Samandoulgou"],
  ["Abdou Azize SAMANDOULGOU", "Azize SAMANDOULGOU"],
  ["Kouassi Bah Jean Pierre YAO", "Jean Pierre YAO"],
  ["Kouassi Bah Jean Pierre YAO", "Kouassi Bah Jean Pierre  YAO"], // double space in SDP users
  ["Veh Frédéric MAÏKA", "VEH FREDERIC MAIKA"],
  ["Pierre Isaac SINKPON", "Isaac Sinkpon"],
  ["Adio Eric Aubin FEGBO", "Eric Fegbo"],
  ["Léonce SORO", "Leonce Soro"],
  ["Moussa Keita", "Moussa"],
];

async function ensureExtensions(client) {
  // unaccent + fuzzystrmatch power the accent-insensitive and Levenshtein
  // passes. If the deployment cannot install them we degrade to exact-only
  // rather than silently mis-matching.
  const out = { unaccent: false, fuzzystrmatch: false };
  for (const ext of ["unaccent", "fuzzystrmatch", "pg_trgm"]) {
    try {
      await client.query(`CREATE EXTENSION IF NOT EXISTS ${ext}`);
      if (ext in out) out[ext] = true;
    } catch { /* not superuser — resolution falls back to exact matching */ }
  }
  const { rows } = await client.query(
    `SELECT extname FROM pg_extension WHERE extname IN ('unaccent','fuzzystrmatch','pg_trgm')`);
  const have = new Set(rows.map((r) => r.extname));
  return { unaccent: have.has("unaccent"), fuzzystrmatch: have.has("fuzzystrmatch") };
}

// ===== people =====

async function listPeople({ includeInactive = false, siteCode, employment } = {}) {
  const params = [];
  const where = ["p.deleted_at IS NULL"];
  if (!includeInactive) where.push("p.active");
  if (siteCode) { params.push(siteCode); where.push(`p.site_code = $${params.length}`); }
  if (employment) { params.push(employment); where.push(`p.employment = $${params.length}`); }
  const { rows } = await query(
    `SELECT p.*, u.name AS pulse_user_name, u.email AS pulse_email,
            (SELECT count(*)::int FROM emid.person_alias a
              WHERE a.person_id = p.person_id) AS alias_count
       FROM emid.person p
       LEFT JOIN public.users u ON u.id = p.user_id
      WHERE ${where.join(" AND ")}
      ORDER BY p.display_name`, params);
  return rows;
}

async function createPerson(actor, input) {
  if (actor.role !== "ADMIN") throw forbidden("Only an Admin maintains the identity register");
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO emid.person (display_name, site_code, division_code, employment, user_id, upn, entra_oid, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [input.display_name, input.site_code || null, input.division_code || null,
       input.employment || "STAFF", input.user_id || null, input.upn || null,
       input.entra_oid || null, actor.id]);
    await audit.recordCreate(client, "emid_person", rows[0].person_id, actor.id);
    return rows[0];
  });
}

// ===== the resolution pass =====
//
// Runs over every distinct alias handed to it and tries, in order:
//   1. exact on the normalised string        → auto-confirm (provable)
//   2. accent-insensitive on the normalised  → auto-confirm (provable)
//   3. Levenshtein ≤ 2                       → QUEUE with confidence, never commit
// Anything else is queued with no suggestion.
async function resolveAliases(actor, system, aliases, { autoCreate = false } = {}) {
  if (actor.role !== "ADMIN") throw forbidden("Only an Admin runs alias resolution");
  const VALID = ["SDP_TECHNICIAN", "SDP_USER", "PULSE_USER", "TRACKER", "MEETINGS", "INSPECTION"];
  if (!VALID.includes(system)) throw badRequest(`system must be one of ${VALID.join(", ")}`);

  return withTransaction(async (client) => {
    const caps = await ensureExtensions(client);
    const summary = {
      system, considered: 0, exact: 0, unaccent: 0, queued_fuzzy: 0, queued_unknown: 0,
      already_resolved: 0, service_accounts: 0, vendors: 0,
      degraded: !caps.unaccent || !caps.fuzzystrmatch,
    };

    for (const raw of aliases) {
      const alias = String(raw || "").trim();
      if (!alias) continue;
      summary.considered++;
      const aliasNorm = norm(alias);

      // already known?
      const { rows: existing } = await client.query(
        `SELECT person_id, rejected FROM emid.person_alias WHERE system = $1 AND alias = $2`,
        [system, alias]);
      if (existing.length && (existing[0].person_id || existing[0].rejected)) {
        summary.already_resolved++;
        continue;
      }

      // service accounts and vendors: classified, not matched
      if (SERVICE_ACCOUNTS.has(aliasNorm) || VENDORS.has(aliasNorm)) {
        const employment = VENDORS.has(aliasNorm) ? "VENDOR" : "SERVICE_ACCOUNT";
        const { rows: p } = await client.query(
          `INSERT INTO emid.person (display_name, employment, active, created_by)
           VALUES ($1,$2,false,$3) RETURNING person_id`,
          [alias, employment, actor.id]);
        await client.query(
          `INSERT INTO emid.person_alias (system, alias, person_id, match_method, confidence, confirmed_by, confirmed_at, note)
           VALUES ($1,$2,$3,'MANUAL',1.000,$4,now(),$5)
           ON CONFLICT (system, alias) DO UPDATE SET person_id = EXCLUDED.person_id`,
          [system, alias, p.rows?.[0]?.person_id ?? p[0].person_id, actor.id,
           `Classified as ${employment} — excluded from capacity`]);
        if (employment === "VENDOR") summary.vendors++; else summary.service_accounts++;
        continue;
      }

      // 1 — exact on an already-confirmed alias for the same human
      const { rows: exact } = await client.query(
        `SELECT person_id FROM emid.person_alias
          WHERE alias_norm = $1 AND person_id IS NOT NULL LIMIT 1`, [aliasNorm]);
      if (exact.length) {
        await upsertAlias(client, system, alias, exact[0].person_id, "EXACT", 1.0, actor.id);
        summary.exact++;
        continue;
      }

      // 1b — exact against a canonical display name
      const { rows: byName } = await client.query(
        `SELECT person_id FROM emid.person
          WHERE upper(regexp_replace(btrim(display_name), '\\s+', ' ', 'g')) = $1
            AND deleted_at IS NULL LIMIT 1`, [aliasNorm]);
      if (byName.length) {
        await upsertAlias(client, system, alias, byName[0].person_id, "EXACT", 1.0, actor.id);
        summary.exact++;
        continue;
      }

      // 2 — accent-insensitive
      if (caps.unaccent) {
        const { rows: ua } = await client.query(
          `SELECT person_id FROM emid.person
            WHERE upper(unaccent(regexp_replace(btrim(display_name), '\\s+', ' ', 'g'))) = upper(unaccent($1))
              AND deleted_at IS NULL LIMIT 1`, [aliasNorm]);
        if (ua.length) {
          await upsertAlias(client, system, alias, ua[0].person_id, "UNACCENT", 0.98, actor.id);
          summary.unaccent++;
          continue;
        }
      }

      // 3 — fuzzy: QUEUED, never committed
      let suggestion = null;
      if (caps.fuzzystrmatch) {
        const { rows: fz } = await client.query(
          `SELECT person_id, display_name,
                  levenshtein(upper(${caps.unaccent ? "unaccent(display_name)" : "display_name"}),
                              upper(${caps.unaccent ? "unaccent($1)" : "$1"})) AS dist
             FROM emid.person
            WHERE deleted_at IS NULL AND active
            ORDER BY dist ASC LIMIT 1`, [alias]);
        if (fz.length && fz[0].dist <= 2) suggestion = fz[0];
      }

      if (autoCreate && !suggestion) {
        // A technician nobody has ever seen: create the person, but leave the
        // alias UNCONFIRMED so a human still signs it off.
        const { rows: created } = await client.query(
          `INSERT INTO emid.person (display_name, created_by) VALUES ($1,$2) RETURNING person_id`,
          [alias, actor.id]);
        await client.query(
          `INSERT INTO emid.person_alias (system, alias, person_id, match_method, confidence, note)
           VALUES ($1,$2,$3,'EXACT',1.000,'Created from source roster — confirm the person is real')
           ON CONFLICT (system, alias) DO NOTHING`,
          [system, alias, created[0].person_id]);
        summary.exact++;
        continue;
      }

      await client.query(
        `INSERT INTO emid.person_alias (system, alias, person_id, match_method, confidence, note)
         VALUES ($1,$2,NULL,$3,$4,$5)
         ON CONFLICT (system, alias) DO UPDATE SET
           match_method = EXCLUDED.match_method, confidence = EXCLUDED.confidence,
           note = EXCLUDED.note, updated_at = now()`,
        [system, alias, suggestion ? "FUZZY" : null,
         suggestion ? Number((1 - suggestion.dist / Math.max(alias.length, 1)).toFixed(3)) : null,
         suggestion ? `Possible match: ${suggestion.display_name} (edit distance ${suggestion.dist}) — confirm or reject`
           : "No candidate found — assign manually"]);
      if (suggestion) summary.queued_fuzzy++; else summary.queued_unknown++;
    }

    await audit.record(client, {
      entity: "emid_person_alias", entityId: 0, userId: actor.id,
      changes: [{ field: "resolution_run", old: null,
        new: `${system}: ${summary.exact + summary.unaccent} resolved, ${summary.queued_fuzzy + summary.queued_unknown} queued` }],
    });
    return summary;
  });
}

async function upsertAlias(client, system, alias, personId, method, confidence, actorId) {
  await client.query(
    `INSERT INTO emid.person_alias (system, alias, person_id, match_method, confidence, confirmed_by, confirmed_at)
     VALUES ($1,$2,$3,$4,$5,$6,now())
     ON CONFLICT (system, alias) DO UPDATE SET
       person_id = EXCLUDED.person_id, match_method = EXCLUDED.match_method,
       confidence = EXCLUDED.confidence, confirmed_by = EXCLUDED.confirmed_by,
       confirmed_at = now(), updated_at = now()`,
    [system, alias, personId, method, confidence, actorId]);
}

// Seed the pairs we already know are the same human.
async function seedKnownPairs(actor) {
  if (actor.role !== "ADMIN") throw forbidden("Only an Admin maintains the identity register");
  return withTransaction(async (client) => {
    let linked = 0;
    for (const [canonical, variant] of KNOWN_PAIRS) {
      const { rows } = await client.query(
        `SELECT person_id FROM emid.person
          WHERE upper(regexp_replace(btrim(display_name), '\\s+', ' ', 'g')) = $1
            AND deleted_at IS NULL LIMIT 1`, [norm(canonical)]);
      let personId = rows[0]?.person_id;
      if (!personId) {
        const ins = await client.query(
          `INSERT INTO emid.person (display_name, created_by) VALUES ($1,$2) RETURNING person_id`,
          [canonical, actor.id]);
        personId = ins.rows[0].person_id;
      }
      for (const [system, alias] of [["SDP_TECHNICIAN", canonical], ["SDP_TECHNICIAN", variant],
        ["SDP_USER", variant]]) {
        await client.query(
          `INSERT INTO emid.person_alias (system, alias, person_id, match_method, confidence, confirmed_by, confirmed_at, note)
           VALUES ($1,$2,$3,'MANUAL',1.000,$4,now(),'Known duplicate spelling, pre-seeded from the SDP dump')
           ON CONFLICT (system, alias) DO NOTHING`,
          [system, alias, personId, actor.id]);
      }
      linked++;
    }
    return { pairs: linked };
  });
}

// ===== the review queue =====

async function pendingAliases({ limit = 200 } = {}) {
  const { rows } = await query(
    `SELECT a.system, a.alias, a.alias_norm, a.match_method, a.confidence, a.note, a.created_at
       FROM emid.person_alias a
      WHERE a.person_id IS NULL AND a.rejected = false
      ORDER BY a.confidence DESC NULLS LAST, a.alias
      LIMIT $1`, [limit]);
  return rows;
}

async function confirmAlias(actor, system, alias, personId) {
  if (actor.role !== "ADMIN") throw forbidden("Only an Admin confirms an identity match");
  return withTransaction(async (client) => {
    const { rows: p } = await client.query(
      `SELECT person_id, display_name FROM emid.person WHERE person_id = $1 AND deleted_at IS NULL`,
      [personId]);
    if (!p.length) throw notFound("Person not found");
    const { rows } = await client.query(
      `UPDATE emid.person_alias
          SET person_id = $3, match_method = 'MANUAL', confidence = 1.000,
              confirmed_by = $4, confirmed_at = now(), rejected = false, updated_at = now()
        WHERE system = $1 AND alias = $2 RETURNING *`,
      [system, alias, personId, actor.id]);
    if (!rows.length) throw notFound("Alias not found");
    await audit.record(client, {
      entity: "emid_person_alias", entityId: personId, userId: actor.id,
      changes: [{ field: `${system}:${alias}`, old: "pending", new: `confirmed as ${p[0].display_name}` }],
    });
    return rows[0];
  });
}

async function rejectAlias(actor, system, alias, note) {
  if (actor.role !== "ADMIN") throw forbidden("Only an Admin rejects an identity match");
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE emid.person_alias
          SET rejected = true, rejected_by = $3, person_id = NULL, note = coalesce($4, note), updated_at = now()
        WHERE system = $1 AND alias = $2 RETURNING *`,
      [system, alias, actor.id, note || null]);
    if (!rows.length) throw notFound("Alias not found");
    await audit.record(client, {
      entity: "emid_person_alias", entityId: 0, userId: actor.id,
      changes: [{ field: `${system}:${alias}`, old: "pending", new: "rejected" }],
    });
    return rows[0];
  });
}

// ===== coverage: the GATE 0 measurement =====
//
// Reads from whatever is mounted at sdp_fdw. Returns an honest "unavailable"
// rather than a fabricated number when the SDP side is not connected.
async function attributionCoverage({ from = "2026-01-01" } = {}) {
  const { rows: mounted } = await query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'sdp_fdw' AND table_name = 'request_records'`);
  if (!mounted.length) {
    return {
      available: false,
      reason: "sdp_fdw.request_records is not mounted — connect the SDP source to measure coverage",
      code: "BLOCKED_EXTERNAL",
    };
  }
  const { rows } = await query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE pa.person_id IS NOT NULL)::int AS attributed,
            count(DISTINCT r.technician) FILTER (WHERE pa.person_id IS NULL) AS unresolved_names
       FROM sdp_fdw.request_records r
       LEFT JOIN emid.person_alias pa
         ON pa.system = 'SDP_TECHNICIAN'
        AND pa.alias_norm = upper(regexp_replace(btrim(r.technician), '\\s+', ' ', 'g'))
        AND pa.person_id IS NOT NULL
      WHERE r.created_time >= $1 AND r.technician IS NOT NULL`, [from]);
  const r = rows[0];
  const coverage = r.total ? Number((r.attributed / r.total).toFixed(3)) : 0;
  return {
    available: true, from, total: r.total, attributed: r.attributed,
    coverage, unresolved_names: Number(r.unresolved_names),
    gate0_pass: coverage >= 0.95,
    explanation: `${r.attributed} of ${r.total} tickets since ${from} attribute to a confirmed person (${(coverage * 100).toFixed(1)}%). ` +
      (coverage >= 0.95 ? "Gate 0 threshold met." : `Gate 0 needs 95% — ${r.unresolved_names} technician spelling(s) still unresolved.`),
  };
}

// Site alias coverage: which ticket labels have no canonical mapping?
async function unmappedSiteLabels({ from = "2026-01-01", minCount = 20 } = {}) {
  const { rows: mounted } = await query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'sdp_fdw' AND table_name = 'request_records'`);
  if (!mounted.length) return { available: false, code: "BLOCKED_EXTERNAL", rows: [] };
  const { rows } = await query(
    `SELECT r.site AS label, count(*)::int AS tickets
       FROM sdp_fdw.request_records r
       LEFT JOIN emid.site_alias sa ON sa.system = 'SDP_TICKET_LABEL' AND sa.alias = r.site
      WHERE sa.code IS NULL AND r.created_time >= $1 AND r.site IS NOT NULL
      GROUP BY 1 HAVING count(*) > $2 ORDER BY 2 DESC`, [from, minCount]);
  return { available: true, rows };
}

module.exports = {
  norm, listPeople, createPerson, resolveAliases, seedKnownPairs,
  pendingAliases, confirmAlias, rejectAlias,
  attributionCoverage, unmappedSiteLabels,
  SERVICE_ACCOUNTS, VENDORS, KNOWN_PAIRS,
};
