-- SPM Phase 1 finisher — project templates/blueprints + custom fields.
-- A template instantiates a repeatable project shape (milestones at day
-- offsets, workstreams, deliverables, governance default). Custom fields are
-- Admin-defined, typed, validated SERVER-SIDE, stored per project in JSONB.
CREATE TABLE project_templates (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  description text,
  governance text NOT NULL DEFAULT 'STANDARD' CHECK (governance IN ('LITE','STANDARD')),
  milestones_json jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{title,type,offset_days}]
  workstreams_json jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{title}]
  deliverables_json jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{title}]
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX project_templates_name_ux ON project_templates (lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE custom_field_defs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity text NOT NULL DEFAULT 'project' CHECK (entity IN ('project')),
  key text NOT NULL,
  label text NOT NULL,
  type text NOT NULL CHECK (type IN ('text','number','date','select')),
  options_json jsonb,                  -- for select
  required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users(id),
  deleted_at timestamptz,
  UNIQUE (entity, key)
);

ALTER TABLE projects ADD COLUMN custom_json jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE projects ADD COLUMN template_id bigint REFERENCES project_templates(id);
