-- SPM Phase 5 — Health 2.0.
-- Progress stops being milestone-count-only: a project declares HOW its
-- progress is measured. MILESTONE keeps the existing behaviour and stays the
-- default, so no existing project changes meaning.
ALTER TABLE projects
  ADD COLUMN progress_method text NOT NULL DEFAULT 'MILESTONE'
    CHECK (progress_method IN ('MILESTONE','TASK','EFFORT','COST','PHYSICAL')),
  ADD COLUMN progress_manual int CHECK (progress_manual BETWEEN 0 AND 100),
  ADD COLUMN progress_manual_note text,
  -- PHYSICAL progress is a human judgement, so it must carry a justification
  ADD CONSTRAINT projects_physical_progress_justified
    CHECK (progress_method <> 'PHYSICAL' OR progress_manual IS NULL
           OR (progress_manual_note IS NOT NULL AND length(btrim(progress_manual_note)) >= 10));
