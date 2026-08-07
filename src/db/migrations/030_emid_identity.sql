-- PULSE ↔ SDP integration, PHASE 0 — the identity spine.
--
-- Nothing else in this programme works until a technician name in ServiceDesk
-- Plus and a user in PULSE can be proven to be the same human. This migration
-- creates the canonical dimensions (site, person, org unit) and the APPEND-ONLY
-- alias tables that map every spelling in every system onto them.
--
-- Two rules the rest of the programme depends on:
--   1. Never join two systems on a name. Join on a canonical id.
--   2. An alias is permanent evidence. A code is never renamed in place —
--      a new alias row is added instead, so historical roll-ups stay valid.
--
-- Fuzzy matches are NEVER auto-committed: person_alias.person_id stays NULL
-- until a human confirms it, and confirmed_by/confirmed_at record who did.

CREATE SCHEMA IF NOT EXISTS emid;

-- ===== canonical site =====
CREATE TABLE emid.site (
  code        text PRIMARY KEY,
  name        text NOT NULL,
  country     char(2),
  site_type   text NOT NULL CHECK (site_type IN ('MINE','OFFICE','EXPLORATION','CORPORATE')),
  -- CORPORATE may be excluded from group denominators (decision Q2) — set
  -- explicitly rather than dropping rows silently
  in_scope    boolean NOT NULL DEFAULT true,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE emid.site_alias (
  system  text NOT NULL CHECK (system IN
          ('SDP_TICKET_LABEL','SDP_TECH_GROUP','SDP_SITES_NAME','TRACKER','INSPECTION',
           'MEETINGS','RISK_REGISTER','PULSE')),
  alias   text NOT NULL,
  code    text NOT NULL REFERENCES emid.site(code) ON DELETE RESTRICT,
  note    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (system, alias)
);
CREATE INDEX site_alias_code_idx ON emid.site_alias (code);

-- ===== canonical org unit =====
CREATE TABLE emid.org_unit (
  code       text PRIMARY KEY,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE emid.org_alias (
  system text NOT NULL CHECK (system IN ('SDP_TECH_GROUP','SDP_USER','TRACKER','PULSE')),
  alias  text NOT NULL,
  code   text NOT NULL REFERENCES emid.org_unit(code) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (system, alias)
);
CREATE INDEX org_alias_code_idx ON emid.org_alias (code);

-- ===== canonical person =====
CREATE TABLE emid.person (
  person_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entra_oid     uuid UNIQUE,
  upn           text UNIQUE,
  display_name  text NOT NULL,
  site_code     text REFERENCES emid.site(code) ON DELETE RESTRICT,
  division_code text REFERENCES emid.org_unit(code) ON DELETE RESTRICT,
  -- contractors and vendors change every site's headroom, so they must be
  -- separable from staff (decision Q4)
  employment    text NOT NULL DEFAULT 'STAFF'
                CHECK (employment IN ('STAFF','CONTRACTOR','SERVICE_ACCOUNT','VENDOR')),
  -- the PULSE account for this human, when one exists
  user_id       bigint REFERENCES public.users(id) ON DELETE RESTRICT,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    bigint REFERENCES public.users(id) ON DELETE RESTRICT,
  deleted_at    timestamptz
);
CREATE INDEX person_site_idx ON emid.person (site_code) WHERE deleted_at IS NULL;
CREATE INDEX person_user_idx ON emid.person (user_id) WHERE deleted_at IS NULL;
CREATE INDEX person_employment_idx ON emid.person (employment) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX person_user_ux ON emid.person (user_id) WHERE user_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE emid.person_alias (
  system       text NOT NULL CHECK (system IN
               ('SDP_TECHNICIAN','SDP_USER','PULSE_USER','TRACKER','MEETINGS','INSPECTION')),
  alias        text NOT NULL,
  -- normalised form: trimmed, internal whitespace collapsed, upper-cased.
  -- This is what every lookup joins on, so "Kouassi Bah Jean Pierre  YAO"
  -- (double space, as stored in SDP users) matches the single-spaced spelling.
  alias_norm   text GENERATED ALWAYS AS
               (upper(regexp_replace(btrim(alias), '\s+', ' ', 'g'))) STORED,
  person_id    bigint REFERENCES emid.person(person_id) ON DELETE RESTRICT, -- NULL = pending review
  match_method text CHECK (match_method IN ('EXACT','UNACCENT','FUZZY','MANUAL')),
  confidence   numeric(4,3) CHECK (confidence >= 0 AND confidence <= 1),
  -- evidence: an auditor must be able to ask who confirmed this pairing
  confirmed_by bigint REFERENCES public.users(id) ON DELETE RESTRICT,
  confirmed_at timestamptz,
  -- a rejected alias is kept, not deleted, so the same fuzzy suggestion does
  -- not come back every night
  rejected     boolean NOT NULL DEFAULT false,
  rejected_by  bigint REFERENCES public.users(id) ON DELETE RESTRICT,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (system, alias)
);
CREATE INDEX person_alias_norm_idx ON emid.person_alias (alias_norm);
CREATE INDEX person_alias_person_idx ON emid.person_alias (person_id);
CREATE INDEX person_alias_pending_idx ON emid.person_alias (person_id)
  WHERE person_id IS NULL AND rejected = false;

-- A confirmed alias must carry its evidence; a pending one must not pretend to.
ALTER TABLE emid.person_alias ADD CONSTRAINT person_alias_confirmation_evidence
  CHECK ((person_id IS NULL) OR (match_method IS NOT NULL));

-- ===== canonical calendar month =====
-- Small, boring, and the thing that stops every fact table inventing its own
-- month arithmetic. Populated for 2022-01 .. 2030-12 below.
CREATE TABLE emid.calendar_month (
  period      char(7) PRIMARY KEY CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  first_day   date NOT NULL,
  last_day    date NOT NULL,
  year        int NOT NULL,
  quarter     int NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  working_days int NOT NULL CHECK (working_days > 0)
);

INSERT INTO emid.calendar_month (period, first_day, last_day, year, quarter, working_days)
SELECT to_char(d, 'YYYY-MM'),
       d::date,
       (d + interval '1 month - 1 day')::date,
       extract(year FROM d)::int,
       extract(quarter FROM d)::int,
       (SELECT count(*)::int FROM generate_series(d, d + interval '1 month - 1 day', interval '1 day') g
         WHERE extract(isodow FROM g) BETWEEN 1 AND 5)
  FROM generate_series('2022-01-01'::date, '2030-12-01'::date, interval '1 month') d;

-- ===== PULSE-side identity columns (defect D6) =====
ALTER TABLE public.users ADD COLUMN entra_oid uuid UNIQUE;
ALTER TABLE public.users ADD COLUMN sdp_technician_alias text;
COMMENT ON COLUMN public.users.entra_oid IS
  'Immutable Entra ID object id, captured at SSO login. The identity anchor — email can change, this cannot.';
COMMENT ON COLUMN public.users.sdp_technician_alias IS
  'Convenience denormalisation of the confirmed SDP technician spelling. emid.person_alias remains the source of truth.';

-- ===== PULSE site corrections (defects D4, D5) =====
-- D4: SML is Lafigué in every SDP module. It was seeded as "Sissingué".
UPDATE public.sites SET name = 'Lafigué', updated_at = now() WHERE code = 'SML';

-- D5: four sites present in SDP but missing from PULSE.
INSERT INTO public.sites (code, name) VALUES
  ('EXPLO',   'Exploration'),
  ('TND',     'Tanda'),
  ('ASSAFO',  'Assafo'),
  ('MASSAWA', 'Massawa')
ON CONFLICT (code) DO NOTHING;
