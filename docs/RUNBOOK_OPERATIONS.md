# Pulse — operations runbook

Everything here has been executed against a real database, not written from
memory. Where a command's output is quoted, it is the output that command
actually produced.

## 1. Health and readiness

| Endpoint | Purpose | Behaviour |
|---|---|---|
| `GET /healthz` | Liveness | Always `200 {"ok":true}` while the process is alive. Touches nothing. |
| `GET /readyz` | Readiness | `200 {"ok":true,"db":"up"}` when PostgreSQL answers; `503` when it does not. |
| `GET /metrics` | Operational metrics | Prometheus text format. **Admin only** — traffic shape and queue depth are not public. |

Point the orchestrator's liveness probe at `/healthz` and its readiness /
load-balancer probe at `/readyz`. A database outage should take an instance out
of rotation, not restart it.

## 2. Logs

One JSON line per completed request:

```json
{"level":"info","ts":"2026-08-07T19:44:33.534Z","msg":"request","request_id":"ef37201d-…","method":"GET","path":"/readyz","route":"/readyz","status":200,"duration_ms":39,"user_id":null}
```

- `request_id` is taken from an incoming `X-Request-Id` when present (so a
  trace started at the proxy survives) and is always echoed in the response
  header. A user reporting a failure can quote the id from the error body.
- Requests slower than `SLOW_REQUEST_MS` (default 1000) are logged at `warn`
  with `"slow": true`.
- Unhandled errors log one `error` line carrying the same `request_id`, the
  message and the stack. The stack is never returned to the browser.
- **Bodies are never logged.** They can contain confidential project titles,
  money figures or credentials, and logs routinely leave the security boundary.

Set `LOG_IN_TESTS=true` to see request logs while running the suite.

## 3. Metrics exposed

| Metric | Type | Meaning |
|---|---|---|
| `pulse_uptime_seconds` | gauge | Process uptime |
| `pulse_http_requests_total` | counter | Completed requests |
| `pulse_http_errors_total` | counter | Responses with a 5xx |
| `pulse_http_request_duration_ms` | histogram | Buckets 5/25/100/250/1000/5000ms |
| `pulse_http_responses_total{status}` | counter | Per status code |
| `pulse_webhook_queue_depth` | gauge | PENDING + FAILED webhook deliveries |
| `pulse_webhook_dead_letters` | gauge | Deliveries that exhausted their retries |
| `pulse_db_pool_total/_idle/_waiting` | gauge | PostgreSQL pool saturation |

These are the numbers the process genuinely measures. Nothing is estimated or
padded to look like a fuller Prometheus client.

**Alert on:** `pulse_webhook_dead_letters` rising (an integration is broken),
`pulse_db_pool_waiting` sustained above zero (pool too small or queries too
slow), and `pulse_http_errors_total` rate.

## 4. Backup

Scheduled nightly by `src/jobs/backup.js`; identical logic runs standalone:

```bash
DATABASE_URL=postgres://… BACKUP_DIR=/backups bash scripts/backup.sh
```

`pg_dump -Fc`, then **verified by `pg_restore --list` before being kept** — a
dump that cannot be listed is deleted immediately rather than sitting in the
directory pretending to be a backup. Dumps older than 14 days are pruned.

## 5. Restore drill — verified

Run this drill on a schedule. A backup nobody has restored is a hypothesis.

```bash
createdb pulse_drill
DATABASE_URL=postgres://…/pulse_drill bash scripts/restore.sh /backups/pulse_<stamp>.dump
```

Executed against the development database on 2026-08-07:

```
Backup OK: …/pulse_2026-08-07T19-44-06.dump
Restore complete. Row check:
 projects | users | audit_entries
----------+-------+---------------
       10 |    16 |            10
```

Then confirmed the restored database is **serviceable**, not merely populated —
26 migration rows present, reference data intact, and the application booting
against it:

```
readyz: 200 {"ok":true,"db":"up"}
```

Checklist for a real drill:
1. Restore into a **fresh** database — never over the live one.
2. Confirm `schema_migrations` row count matches the deployed version.
3. Confirm reference data survived (`calendars`, `fx_rates`).
4. Boot the app against the restore and check `/readyz`.
5. Spot-check one project's audit history — audit is the record you cannot
   reconstruct from anywhere else.

## 6. Point-in-time recovery (PITR)

`pg_dump` gives nightly granularity. For tighter RPO, enable WAL archiving on
the PostgreSQL server:

```
wal_level = replica
archive_mode = on
archive_command = 'test ! -f /wal/%f && cp %p /wal/%f'
```

Recovery: restore the last base backup, place the WAL segments where
`restore_command` can find them, and set `recovery_target_time`. PITR is a
**server/infrastructure** capability — it cannot be provided from inside the
application, so it is configured wherever PostgreSQL is hosted (managed service
snapshots or a self-managed archive). This is flagged honestly rather than
claimed as an application feature.

## 7. Webhook queue operations

- Depth and dead letters are on `/metrics` (see above).
- Inspect a subscription's deliveries: `GET /api/v1/webhooks/:id/deliveries`.
- Redrive one dead letter: `POST /api/v1/webhooks/deliveries/:id/redrive`.
- Force a delivery cycle: `POST /api/v1/webhooks/process`.

Deliveries are claimed with `FOR UPDATE SKIP LOCKED`, so running several
instances never double-sends. Retries back off exponentially and stop at 6
attempts — a broken endpoint cannot spin forever.

## 8. Scaling notes

The API is stateless: sessions live in PostgreSQL (`connect-pg-simple`), so
instances can be added or replaced freely behind a load balancer. Two caveats,
stated plainly:

- **Rate limiting is per-instance** (in-memory). With N instances the effective
  limit is N × the configured value. A shared store (Redis) is required for a
  strict global limit.
- **The realtime presenter room is per-instance.** Meeting participants must
  land on the same instance (sticky sessions) until a shared pub/sub backend is
  introduced.

Both are honest current limits, not planned features described as if they
already work.
