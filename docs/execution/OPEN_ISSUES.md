# Open Issues

- OI-1: one transient test failure observed once in a full-suite run (79-suite,
  meetings-adjacent), not reproducible in two subsequent runs. Suspect fire-and-forget
  channel dispatch racing pool shutdown in test teardown. Mitigation candidate:
  awaitable dispatch queue drained in afterEach. Watch on next runs (flake policy §180).
- OI-2: docker compose runtime untested in sandbox (registry blocked) — first networked
  host run pending.
- OI-3: agenda rule 7 approximates "gates waiting" as DESIGN+milestones; refine when
  gate request records (E05 finish) exist.
