"use strict";
// SPM Phase 4 (remainder) — benefit realization. Pure: given a benefit and its
// time-phased measurements, work out how much of the promised value has
// actually arrived, whether it is on track, and what the evidence is.
//
// The deliberate design point: realization is measured against the BASELINE,
// not from zero. A benefit that moves incident count from 40 to 25 has
// realized 100% when it reaches 25 — not 62%.

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const num = (v) => (v == null ? null : Number(v));

function periodsBetween(start, end, frequency) {
  if (!start || !end) return [];
  const s = new Date(`${String(start).slice(0, 7)}-01T00:00:00Z`);
  const e = new Date(`${String(end).slice(0, 7)}-01T00:00:00Z`);
  const step = frequency === "ANNUAL" ? 12 : frequency === "QUARTERLY" ? 3 : 1;
  const out = [];
  for (let d = s; d <= e; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + step, 1))) {
    out.push(d.toISOString().slice(0, 7));
    if (out.length > 600) break; // 50 years is not a realization plan
  }
  return out;
}

// Fraction of the promised movement achieved, honouring decreasing targets.
function realizedFraction(baseline, target, value) {
  if (baseline == null || target == null || value == null) return null;
  if (Number(target) === Number(baseline)) return null; // no movement promised
  return clamp((Number(value) - Number(baseline)) / (Number(target) - Number(baseline)), 0, 1);
}

function realization(benefit, measurements, { today } = {}) {
  const now = today ? new Date(today) : new Date();
  const nowPeriod = now.toISOString().slice(0, 7);
  const baseline = num(benefit.baseline);
  const target = num(benefit.target);
  const byPeriod = new Map(measurements.map((m) => [m.period, m]));
  const periods = periodsBetween(
    benefit.realization_start, benefit.realization_end, benefit.measurement_frequency);

  const rows = periods.map((p) => {
    const m = byPeriod.get(p) || null;
    const actual = m ? num(m.actual) : null;
    return {
      period: p,
      planned: m ? num(m.planned) : null,
      actual,
      realized_pct: actual == null ? null
        : Math.round((realizedFraction(baseline, target, actual) ?? 0) * 100),
      post_closure: m ? m.post_closure === true : false,
      note: m ? m.note : null,
      due: p <= nowPeriod,
      missing: p <= nowPeriod && (!m || m.actual == null),
    };
  });

  // Measurements outside the declared window still count as evidence — a
  // benefit observed after the plan ended is exactly what we want to keep.
  for (const m of measurements) {
    if (!periods.includes(m.period)) {
      rows.push({
        period: m.period, planned: num(m.planned), actual: num(m.actual),
        realized_pct: m.actual == null ? null
          : Math.round((realizedFraction(baseline, target, num(m.actual)) ?? 0) * 100),
        post_closure: m.post_closure === true, note: m.note,
        due: m.period <= nowPeriod, missing: false, outside_window: true,
      });
    }
  }
  rows.sort((a, b) => a.period.localeCompare(b.period));

  const measured = rows.filter((r) => r.actual != null);
  const latest = measured[measured.length - 1] || null;
  const best = measured.reduce((acc, r) => (acc == null || r.realized_pct > acc.realized_pct ? r : acc), null);
  const missing = rows.filter((r) => r.missing);
  const postClosure = measured.filter((r) => r.post_closure);

  let status = "NOT_STARTED";
  if (latest) {
    status = latest.realized_pct >= 100 ? "REALIZED"
      : latest.realized_pct >= 60 ? "ON_TRACK"
        : latest.realized_pct > 0 ? "PARTIAL" : "NOT_REALIZED";
  }

  const unit = benefit.unit ? ` ${benefit.unit}` : "";
  const explanation = !latest
    ? (periods.length
      ? `No measurement recorded yet across ${periods.length} planned period(s)`
      : "No realization window defined — this benefit cannot be tracked over time")
    : `Latest ${latest.period}: ${latest.actual}${unit} against a baseline of ` +
      `${baseline ?? "?"}${unit} and a target of ${target ?? "?"}${unit} — ` +
      `${latest.realized_pct}% realized` +
      (missing.length ? `; ${missing.length} due period(s) never measured` : "") +
      (postClosure.length ? `; ${postClosure.length} observation(s) recorded after project closure` : "");

  return {
    status,
    periods: rows,
    latest,
    peak: best,
    realized_pct: latest ? latest.realized_pct : null,
    measured_periods: measured.length,
    missing_periods: missing.map((r) => r.period),
    post_closure_observations: postClosure.length,
    sustained: postClosure.length > 0 && postClosure.every((r) => r.realized_pct >= 60),
    explanation,
  };
}

module.exports = { realization, realizedFraction, periodsBetween };
