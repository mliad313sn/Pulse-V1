"use strict";
// SPM Phase 3 — the capacity kernel. Pure functions, no database: given
// allocation rows they bucket committed/tentative/BAU/leave load into future
// weeks or months, day-weighted so a booking that covers half a month costs
// half of its percentage. Availability is what is left after committed
// project work, BAU and leave; tentative load is reported separately because
// planning against maybe-work is how portfolios get oversold.

const DAY = 86400000;

const toDate = (v) => (v instanceof Date ? new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()))
  : new Date(`${String(v).slice(0, 10)}T00:00:00Z`));
const iso = (d) => d.toISOString().slice(0, 10);

// Inclusive day overlap between two ranges; 0 when they do not touch.
function overlapDays(aStart, aEnd, bStart, bEnd) {
  const s = Math.max(toDate(aStart).getTime(), toDate(bStart).getTime());
  const e = Math.min(toDate(aEnd).getTime(), toDate(bEnd).getTime());
  return e < s ? 0 : Math.round((e - s) / DAY) + 1;
}

// Bucket boundaries: `count` consecutive periods starting at `from`.
function buckets(from, count, grain = "month") {
  const start = toDate(from);
  const out = [];
  if (grain === "week") {
    // ISO-ish weeks anchored on the Monday on/before `from`
    const monday = new Date(start);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    for (let i = 0; i < count; i++) {
      const s = new Date(monday.getTime() + i * 7 * DAY);
      const e = new Date(s.getTime() + 6 * DAY);
      out.push({ key: iso(s), label: `Week of ${iso(s)}`, start: iso(s), end: iso(e) });
    }
    return out;
  }
  for (let i = 0; i < count; i++) {
    const s = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const e = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 0));
    out.push({ key: iso(s).slice(0, 7), label: iso(s).slice(0, 7), start: iso(s), end: iso(e) });
  }
  return out;
}

// Day-weighted load for one person over one period.
// capacityPercent lets a part-timer be modelled honestly (e.g. 60).
function loadForPeriod(allocations, period, capacityPercent = 100) {
  const periodDays = overlapDays(period.start, period.end, period.start, period.end);
  const acc = { committed: 0, tentative: 0, bau: 0, leave: 0 };
  const contributors = [];
  for (const a of allocations) {
    const days = overlapDays(a.start_date, a.end_date, period.start, period.end);
    if (!days) continue;
    const weighted = (Number(a.percent) * days) / periodDays;
    const type = a.allocation_type || "PROJECT";
    const tentative = (a.commitment || "COMMITTED") === "TENTATIVE";
    if (type === "LEAVE") acc.leave += weighted;
    else if (type === "BAU") acc.bau += weighted;
    else if (tentative) acc.tentative += weighted;
    else acc.committed += weighted;
    contributors.push({
      allocation_id: a.id, project_code: a.project_code || null, type, tentative,
      percent: Number(a.percent), days_in_period: days, weighted_percent: round(weighted),
    });
  }
  // Leave removes capacity; BAU and committed project work consume what is left.
  const capacity = Math.max(0, capacityPercent - acc.leave);
  const used = acc.committed + acc.bau;
  return {
    period: period.key, label: period.label, start: period.start, end: period.end,
    capacity_percent: round(capacity),
    committed_percent: round(acc.committed),
    bau_percent: round(acc.bau),
    leave_percent: round(acc.leave),
    tentative_percent: round(acc.tentative),
    used_percent: round(used),
    available_percent: round(capacity - used),
    over_allocated: used > capacity + 0.001,
    at_risk: used <= capacity + 0.001 && used + acc.tentative > capacity + 0.001,
    contributors,
  };
}

const round = (n) => Math.round(n * 10) / 10;

// Full forecast for one person.
function forecast(allocations, { from, periods = 6, grain = "month", capacityPercent = 100 } = {}) {
  const bs = buckets(from, periods, grain);
  const rows = bs.map((b) => loadForPeriod(allocations, b, capacityPercent));
  for (const r of rows) {
    r.explanation = r.over_allocated
      ? `Over-allocated: ${r.used_percent}% booked against ${r.capacity_percent}% capacity` +
        (r.leave_percent ? ` (${r.leave_percent}% of the period is leave)` : "") + " — " +
        r.contributors.filter((c) => c.type !== "LEAVE" && !c.tentative)
          .map((c) => `${c.project_code || c.type} ${c.weighted_percent}%`).join(", ")
      : r.at_risk
        ? `Fits today, but ${r.tentative_percent}% of tentative work would push it to ` +
          `${round(r.used_percent + r.tentative_percent)}% against ${r.capacity_percent}% capacity`
        : `${r.available_percent}% free of ${r.capacity_percent}% capacity`;
  }
  return rows;
}

// Candidate ranking for a role-based request. Pure: the caller supplies
// candidates already filtered to what it is allowed to see.
// Score = skill fit (0-50) + availability (0-40) + site match (0-10).
function rankCandidates(candidates, request) {
  const need = Number(request.percent);
  const ranked = candidates.map((c) => {
    const reasons = [];
    let score = 0;

    if (request.skill_id) {
      if (!c.proficiency) {
        return { ...c, score: 0, eligible: false,
          reason: `No recorded ${request.skill_name || "required"} skill` };
      }
      if (request.min_proficiency && c.proficiency < request.min_proficiency) {
        return { ...c, score: 0, eligible: false,
          reason: `${request.skill_name || "Skill"} proficiency ${c.proficiency} is below the required ${request.min_proficiency}` };
      }
      score += (c.proficiency / 5) * 40;
      reasons.push(`${request.skill_name || "skill"} proficiency ${c.proficiency}/5`);
      if (c.certified) { score += 10; reasons.push("certified"); }
      else reasons.push("not certified");
    } else {
      score += 25; // no skill constraint — everyone is equally plausible on fit
    }

    const free = Number(c.available_percent ?? 0);
    if (free >= need) {
      score += 40;
      reasons.push(`${round(free)}% free covers the ${need}% requested`);
    } else if (free > 0) {
      score += (free / need) * 40;
      reasons.push(`only ${round(free)}% free against ${need}% requested`);
    } else {
      reasons.push("no free capacity in the window");
    }

    if (request.site_id && c.site_id === request.site_id) { score += 10; reasons.push("on site"); }
    else if (request.site_id) reasons.push("different site");

    return {
      ...c,
      score: Math.round(score),
      eligible: free > 0,
      fits_fully: free >= need,
      reason: reasons.join("; "),
    };
  });
  return ranked.sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name)));
}

module.exports = { forecast, loadForPeriod, buckets, overlapDays, rankCandidates };
