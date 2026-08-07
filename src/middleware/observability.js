"use strict";
// SPM Phase 12 — structured logging and metrics.
//
// Every request gets an id (honouring an upstream X-Request-Id so a trace
// survives a proxy), one JSON line per completed request, and the same id on
// any error line so a failure can be tied back to the request that caused it.
// Logs deliberately carry identifiers and never request bodies: a body can
// hold confidential titles, money or credentials, and logs are the one place
// that routinely leaves the security boundary.
const crypto = require("crypto");

const SLOW_MS = Number(process.env.SLOW_REQUEST_MS || 1000);
const SILENT = process.env.NODE_ENV === "test" && process.env.LOG_IN_TESTS !== "true";

// In-process counters. Deliberately a small honest subset rather than a
// pretend Prometheus client: totals, error counts and a duration histogram.
const BUCKETS = [5, 25, 100, 250, 1000, 5000];
const metrics = {
  startedAt: Date.now(),
  requests: 0,
  errors: 0,
  byStatus: new Map(),
  durationBuckets: new Array(BUCKETS.length + 1).fill(0),
  durationSum: 0,
};

function record(status, ms) {
  metrics.requests++;
  if (status >= 500) metrics.errors++;
  metrics.byStatus.set(status, (metrics.byStatus.get(status) || 0) + 1);
  metrics.durationSum += ms;
  const idx = BUCKETS.findIndex((b) => ms <= b);
  metrics.durationBuckets[idx === -1 ? BUCKETS.length : idx]++;
}

function log(level, fields) {
  if (SILENT) return;
  const line = JSON.stringify({ level, ts: new Date().toISOString(), ...fields });
  if (level === "error") console.error(line);
  else console.log(line);
}

function requestLogger(req, res, next) {
  const started = process.hrtime.bigint();
  req.id = req.get("x-request-id") || crypto.randomUUID();
  res.setHeader("x-request-id", req.id);
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    record(res.statusCode, ms);
    // route pattern rather than the raw URL: ids in a path are data
    const route = (req.baseUrl || "") + (req.route?.path || "");
    log(res.statusCode >= 500 ? "error" : ms > SLOW_MS ? "warn" : "info", {
      msg: "request",
      request_id: req.id,
      method: req.method,
      path: req.originalUrl.split("?")[0],
      route: route || undefined,
      status: res.statusCode,
      duration_ms: Math.round(ms * 10) / 10,
      user_id: req.session?.userId || null,
      slow: ms > SLOW_MS || undefined,
    });
  });
  next();
}

// Prometheus text exposition of what we actually measure — nothing invented.
function renderMetrics(extra = {}) {
  const lines = [
    "# HELP pulse_uptime_seconds Process uptime",
    "# TYPE pulse_uptime_seconds gauge",
    `pulse_uptime_seconds ${Math.round((Date.now() - metrics.startedAt) / 1000)}`,
    "# HELP pulse_http_requests_total Completed HTTP requests",
    "# TYPE pulse_http_requests_total counter",
    `pulse_http_requests_total ${metrics.requests}`,
    "# HELP pulse_http_errors_total Requests answered with a 5xx",
    "# TYPE pulse_http_errors_total counter",
    `pulse_http_errors_total ${metrics.errors}`,
    "# HELP pulse_http_request_duration_ms Request duration histogram",
    "# TYPE pulse_http_request_duration_ms histogram",
  ];
  let cumulative = 0;
  BUCKETS.forEach((b, i) => {
    cumulative += metrics.durationBuckets[i];
    lines.push(`pulse_http_request_duration_ms_bucket{le="${b}"} ${cumulative}`);
  });
  cumulative += metrics.durationBuckets[BUCKETS.length];
  lines.push(`pulse_http_request_duration_ms_bucket{le="+Inf"} ${cumulative}`);
  lines.push(`pulse_http_request_duration_ms_sum ${Math.round(metrics.durationSum)}`);
  lines.push(`pulse_http_request_duration_ms_count ${metrics.requests}`);

  for (const [status, n] of [...metrics.byStatus].sort()) {
    lines.push(`pulse_http_responses_total{status="${status}"} ${n}`);
  }
  for (const [name, value] of Object.entries(extra)) {
    lines.push(`# TYPE ${name} gauge`, `${name} ${value}`);
  }
  return lines.join("\n") + "\n";
}

module.exports = { requestLogger, renderMetrics, log, metrics };
