# Pulse — data dictionary

**Generated from the live schema** by `scripts/generate_data_dictionary.js`.
Do not edit by hand — regenerate after adding a migration so it cannot drift.

Tables: 64. Every table carries `created_at`/`updated_at`; most carry
`deleted_at` (soft delete — history is never destroyed) and `created_by`.

## actions

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `project_id` | bigint | yes |  |
| `meeting_id` | bigint | yes |  |
| `title` | text | no |  |
| `owner_user_id` | bigint | no |  |
| `due_date` | date | yes |  |
| `status` | text | no | `'OPEN'::text` |
| `done_date` | date | yes |  |
| `source` | text | no | `'PROJECT'::text` |
| `roadblock_id` | bigint | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**Rules enforced by the database:**
- `CHECK ((status = ANY (ARRAY['OPEN'::text, 'DONE'::text, 'CANCELLED'::text])))`
- `CHECK ((source = ANY (ARRAY['MEETING'::text, 'PROJECT'::text, 'ROADBLOCK'::text])))`

**References:**
- `FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT`
- `FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT`
- `FOREIGN KEY (roadblock_id) REFERENCES roadblocks(id) ON DELETE RESTRICT`
- `FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT`
- `FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE RESTRICT`

## attachments

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `project_id` | bigint | no |  |
| `entity_type` | text | no | `'project'::text` |
| `entity_id` | bigint | yes |  |
| `filename` | text | no |  |
| `media_type` | text | no |  |
| `size_bytes` | bigint | no |  |
| `sha256` | character | no |  |
| `storage_key` | text | no |  |
| `version` | integer | no | `1` |
| `description` | text | yes |  |
| `classification` | text | no | `'GENERAL'::text` |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**Rules enforced by the database:**
- `CHECK ((entity_type = ANY (ARRAY['project'::text, 'milestone'::text, 'roadblock'::text, 'decision'::text, 'deliverable'::text, 'meeting'::text, 'task'::text, 'capa'::text, 'gate'::text])))`
- `CHECK ((size_bytes >= 0))`
- `CHECK ((classification = ANY (ARRAY['GENERAL'::text, 'CONFIDENTIAL'::text])))`

**Uniqueness:**
- `UNIQUE (storage_key)`

**References:**
- `FOREIGN KEY (created_by) REFERENCES users(id)`
- `FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT`

## audit_log

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `entity` | text | no |  |
| `entity_id` | bigint | yes |  |
| `field` | text | yes |  |
| `old_value` | text | yes |  |
| `new_value` | text | yes |  |
| `user_id` | bigint | yes |  |
| `timestamp` | timestamp with time zone | no | `now()` |

**References:**
- `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT`

## benefit_measurements

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `benefit_id` | bigint | no |  |
| `period` | character | no |  |
| `planned` | numeric | yes |  |
| `actual` | numeric | yes |  |
| `note` | text | yes |  |
| `post_closure` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**Rules enforced by the database:**
- `CHECK ((period ~ '^[0-9]{4}-[0-9]{2}$'::text))`

**Uniqueness:**
- `UNIQUE (benefit_id, period)`

**References:**
- `FOREIGN KEY (created_by) REFERENCES users(id)`
- `FOREIGN KEY (benefit_id) REFERENCES benefits(id)`

## benefits

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `project_id` | bigint | no |  |
| `title` | text | no |  |
| `owner_user_id` | bigint | yes |  |
| `baseline` | numeric | yes |  |
| `target` | numeric | yes |  |
| `unit` | text | yes |  |
| `measure_method` | text | yes |  |
| `target_date` | date | yes |  |
| `actual` | numeric | yes |  |
| `status` | text | no | `'DEFINED'::text` |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |
| `realization_start` | date | yes |  |
| `realization_end` | date | yes |  |
| `measurement_frequency` | text | no | `'MONTHLY'::text` |
| `monetary` | boolean | no | `false` |

**Rules enforced by the database:**
- `CHECK ((measurement_frequency = ANY (ARRAY['MONTHLY'::text, 'QUARTERLY'::text, 'ANNUAL'::text])))`
- `CHECK ((status = ANY (ARRAY['DEFINED'::text, 'ON_TRACK'::text, 'AT_RISK'::text, 'ACHIEVED'::text, 'MISSED'::text])))`
- `CHECK (((realization_end IS NULL) OR (realization_start IS NULL) OR (realization_end >= realization_start)))`

**References:**
- `FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT`
- `FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT`
- `FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT`

## budget_lines

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `project_id` | bigint | no |  |
| `category` | text | no |  |
| `capex_opex` | text | no | `'CAPEX'::text` |
| `currency` | character | no | `'USD'::bpchar` |
| `approved` | numeric | no | `0` |
| `committed` | numeric | no | `0` |
| `actual` | numeric | no | `0` |
| `forecast` | numeric | no | `0` |
| `note` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**Rules enforced by the database:**
- `CHECK ((actual >= (0)::numeric))`
- `CHECK ((committed >= (0)::numeric))`
- `CHECK ((approved >= (0)::numeric))`
- `CHECK ((capex_opex = ANY (ARRAY['CAPEX'::text, 'OPEX'::text])))`
- `CHECK ((forecast >= (0)::numeric))`
- `CHECK ((category = ANY (ARRAY['Hardware'::text, 'Software'::text, 'Professional Services'::text, 'Telecom'::text, 'Travel'::text, 'Training'::text, 'Internal Resource'::text, 'Contingency'::text, 'Other'::text])))`

**References:**
- `FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT`
- `FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT`
- `FOREIGN KEY (currency) REFERENCES fx_rates(currency)`

## calendar_exceptions

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `calendar_id` | bigint | no |  |
| `exception_date` | date | no |  |
| `working` | boolean | no | `false` |
| `note` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |

**Uniqueness:**
- `UNIQUE (calendar_id, exception_date)`

**References:**
- `FOREIGN KEY (created_by) REFERENCES users(id)`
- `FOREIGN KEY (calendar_id) REFERENCES calendars(id)`

## calendars

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `name` | text | no |  |
| `working_days` | ARRAY | no | `'{1,2,3,4,5}'::integer[]` |
| `hours_per_day` | numeric | no | `8` |
| `is_default` | boolean | no | `false` |
| `description` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**Rules enforced by the database:**
- `CHECK (((hours_per_day > (0)::numeric) AND (hours_per_day <= (24)::numeric)))`

**References:**
- `FOREIGN KEY (created_by) REFERENCES users(id)`

## capas

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `project_id` | bigint | no |  |
| `source_type` | text | no | `'MANUAL'::text` |
| `roadblock_id` | bigint | yes |  |
| `risk_id` | bigint | yes |  |
| `issue` | text | no |  |
| `root_cause` | text | yes |  |
| `immediate_correction` | text | yes |  |
| `corrective_action` | text | yes |  |
| `preventive_action` | text | yes |  |
| `owner_user_id` | bigint | yes |  |
| `verifier_user_id` | bigint | yes |  |
| `due_date` | date | yes |  |
| `status` | text | no | `'OPEN'::text` |
| `evidence` | text | yes |  |
| `verification_date` | date | yes |  |
| `effectiveness` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**Rules enforced by the database:**
- `CHECK ((status = ANY (ARRAY['OPEN'::text, 'ANALYSIS'::text, 'ACTION_PLANNED'::text, 'IMPLEMENTATION'::text, 'VERIFICATION'::text, 'CLOSED'::text])))`
- `CHECK ((effectiveness = ANY (ARRAY['EFFECTIVE'::text, 'PARTIALLY_EFFECTIVE'::text, 'NOT_EFFECTIVE'::text])))`
- `CHECK ((source_type = ANY (ARRAY['ROADBLOCK'::text, 'RISK'::text, 'AUDIT'::text, 'INCIDENT'::text, 'REVIEW'::text, 'MANUAL'::text])))`

**References:**
- `FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT`
- `FOREIGN KEY (risk_id) REFERENCES risks(id) ON DELETE RESTRICT`
- `FOREIGN KEY (roadblock_id) REFERENCES roadblocks(id) ON DELETE RESTRICT`
- `FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT`
- `FOREIGN KEY (verifier_user_id) REFERENCES users(id) ON DELETE RESTRICT`
- `FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT`

## change_requests

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `project_id` | bigint | no |  |
| `type` | text | no |  |
| `title` | text | no |  |
| `rationale` | text | no |  |
| `impact_analysis` | text | yes |  |
| `affected_milestones` | text | yes |  |
| `cost_impact` | numeric | yes |  |
| `schedule_impact_days` | integer | yes |  |
| `risk_impact` | text | yes |  |
| `status` | text | no | `'PENDING'::text` |
| `decision_note` | text | yes |  |
| `approver_id` | bigint | yes |  |
| `decided_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**Rules enforced by the database:**
- `CHECK ((type = ANY (ARRAY['SCOPE'::text, 'SCHEDULE'::text, 'BUDGET'::text, 'BENEFIT'::text, 'RESOURCE'::text, 'CANCELLATION'::text])))`
- `CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text])))`

**References:**
- `FOREIGN KEY (created_by) REFERENCES users(id)`
- `FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT`
- `FOREIGN KEY (approver_id) REFERENCES users(id)`

## cost_plans

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `project_id` | bigint | no |  |
| `period` | character | no |  |
| `planned` | numeric | no |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |

**Rules enforced by the database:**
- `CHECK ((planned >= (0)::numeric))`
- `CHECK ((period ~ '^\d{4}-\d{2}$'::text))`

**Uniqueness:**
- `UNIQUE (project_id, period)`

**References:**
- `FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT`
- `FOREIGN KEY (created_by) REFERENCES users(id)`

## custom_field_defs

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `entity` | text | no | `'project'::text` |
| `key` | text | no |  |
| `label` | text | no |  |
| `type` | text | no |  |
| `options_json` | jsonb | yes |  |
| `required` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**Rules enforced by the database:**
- `CHECK ((type = ANY (ARRAY['text'::text, 'number'::text, 'date'::text, 'select'::text])))`
- `CHECK ((entity = 'project'::text))`

**Uniqueness:**
- `UNIQUE (entity, key)`

**References:**
- `FOREIGN KEY (created_by) REFERENCES users(id)`

## decisions

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `project_id` | bigint | no |  |
| `meeting_id` | bigint | yes |  |
| `text` | text | no |  |
| `decided_by` | text | yes |  |
| `date` | date | no |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |
| `change_request_id` | bigint | yes |  |

**References:**
- `FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT`
- `FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT`
- `FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE RESTRICT`
- `FOREIGN KEY (change_request_id) REFERENCES change_requests(id)`

## deliverables

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `project_id` | bigint | no |  |
| `title` | text | no |  |
| `description` | text | yes |  |
| `due_date` | date | yes |  |
| `status` | text | no | `'PENDING'::text` |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**Rules enforced by the database:**
- `CHECK ((status = ANY (ARRAY['PENDING'::text, 'IN_PROGRESS'::text, 'DELIVERED'::text])))`

**References:**
- `FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT`
- `FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT`

## demands

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `title` | text | no |  |
| `problem` | text | yes |  |
| `outcome_hypothesis` | text | yes |  |
| `requester_id` | bigint | yes |  |
| `division_id` | bigint | yes |  |
| `site_id` | bigint | yes |  |
| `status` | text | no | `'DRAFT'::text` |
| `estimated_cost` | numeric | yes |  |
| `estimated_effort_weeks` | numeric | yes |  |
| `business_value` | integer | yes |  |
| `time_criticality` | integer | yes |  |
| `risk_reduction` | integer | yes |  |
| `reach` | integer | yes |  |
| `impact` | numeric | yes |  |
| `confidence` | integer | yes |  |
| `cost_of_delay_week` | numeric | yes |  |
| `mandatory` | boolean | no | `false` |
| `mandatory_reason` | text | yes |  |
| `decided_by` | bigint | yes |  |
| `decided_at` | timestamp with time zone | yes |  |
| `decision_note` | text | yes |  |
| `converted_project_id` | bigint | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**Rules enforced by the database:**
- `CHECK ((reach >= 0))`
- `CHECK ((impact >= (0)::numeric))`
- `CHECK (((confidence >= 0) AND (confidence <= 100)))`
- `CHECK (((risk_reduction >= 1) AND (risk_reduction <= 10)))`
- `CHECK (((NOT mandatory) OR (length(TRIM(BOTH FROM COALESCE(mandatory_reason, ''::text))) >= 10)))`
- `CHECK (((time_criticality >= 1) AND (time_criticality <= 10)))`
- `CHECK (((business_value >= 1) AND (business_value <= 10)))`
- `CHECK ((status = ANY (ARRAY['DRAFT'::text, 'SUBMITTED'::text, 'APPROVED'::text, 'REJECTED'::text, 'CONVERTED'::text])))`
- `CHECK ((cost_of_delay_week >= (0)::numeric))`

**References:**
- `FOREIGN KEY (decided_by) REFERENCES users(id)`
- `FOREIGN KEY (site_id) REFERENCES sites(id)`
- `FOREIGN KEY (converted_project_id) REFERENCES projects(id)`
- `FOREIGN KEY (created_by) REFERENCES users(id)`
- `FOREIGN KEY (division_id) REFERENCES divisions(id)`
- `FOREIGN KEY (requester_id) REFERENCES users(id)`

## divisions

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `code` | text | no |  |
| `name` | text | no |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**Uniqueness:**
- `UNIQUE (code)`

**References:**
- `FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT`

## external_links

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `system` | text | no |  |
| `external_id` | text | no |  |
| `external_key` | text | yes |  |
| `external_url` | text | yes |  |
| `entity` | text | no |  |
| `entity_id` | bigint | no |  |
| `last_synced_at` | timestamp with time zone | yes |  |
| `sync_state` | text | no | `'LINKED'::text` |
| `last_error` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**Rules enforced by the database:**
- `CHECK ((sync_state = ANY (ARRAY['LINKED'::text, 'ERROR'::text, 'ORPHANED'::text])))`

**References:**
- `FOREIGN KEY (created_by) REFERENCES users(id)`

## fx_rates

| Column | Type | Null | Default |
|---|---|---|---|
| `currency` | character | no |  |
| `rate_to_base` | numeric | no |  |
| `updated_at` | timestamp with time zone | no | `now()` |
| `updated_by` | bigint | yes |  |

**Rules enforced by the database:**
- `CHECK ((rate_to_base > (0)::numeric))`

**References:**
- `FOREIGN KEY (updated_by) REFERENCES users(id)`

## key_results

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `objective_id` | bigint | no |  |
| `title` | text | no |  |
| `baseline` | numeric | no |  |
| `target` | numeric | no |  |
| `current` | numeric | yes |  |
| `unit` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**Rules enforced by the database:**
- `CHECK ((target <> baseline))`

**References:**
- `FOREIGN KEY (created_by) REFERENCES users(id)`
- `FOREIGN KEY (objective_id) REFERENCES objectives(id) ON DELETE RESTRICT`

## meeting_attendees

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `meeting_id` | bigint | no |  |
| `user_id` | bigint | no |  |
| `present` | boolean | no | `false` |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**Uniqueness:**
- `UNIQUE (meeting_id, user_id)`

**References:**
- `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT`
- `FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT`
- `FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE RESTRICT`

## meeting_items

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `meeting_id` | bigint | no |  |
| `project_id` | bigint | yes |  |
| `order_index` | integer | no | `0` |
| `notes` | text | yes |  |
| `reason` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**References:**
- `FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE RESTRICT`
- `FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT`
- `FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT`

## meeting_minutes_versions

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `meeting_id` | bigint | no |  |
| `version` | integer | no |  |
| `minutes_json` | jsonb | no |  |
| `closed_by` | bigint | no |  |
| `created_at` | timestamp with time zone | no | `now()` |

**Uniqueness:**
- `UNIQUE (meeting_id, version)`

**References:**
- `FOREIGN KEY (closed_by) REFERENCES users(id) ON DELETE RESTRICT`
- `FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE RESTRICT`

## meetings

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `title` | text | no |  |
| `date` | date | no |  |
| `type` | text | no |  |
| `status` | text | no | `'PLANNED'::text` |
| `site_id` | bigint | yes |  |
| `minutes_json` | jsonb | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**Rules enforced by the database:**
- `CHECK ((type = ANY (ARRAY['INFRA_OPS_SYNC'::text, 'PROJECT_REVIEW'::text, 'ADHOC'::text])))`
- `CHECK ((status = ANY (ARRAY['PLANNED'::text, 'LIVE'::text, 'CLOSED'::text])))`

**References:**
- `FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE RESTRICT`
- `FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT`

## milestones

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `project_id` | bigint | no |  |
| `title` | text | no |  |
| `type` | text | no | `'STANDARD'::text` |
| `owner_division_id` | bigint | yes |  |
| `owner_user_id` | bigint | yes |  |
| `co_owner_user_id` | bigint | yes |  |
| `site_id` | bigint | yes |  |
| `due_date` | date | yes |  |
| `status` | text | no | `'NOT_STARTED'::text` |
| `done_date` | date | yes |  |
| `order_index` | integer | no | `0` |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**Rules enforced by the database:**
- `CHECK ((type = ANY (ARRAY['STANDARD'::text, 'SECURITY_GATE'::text, 'SITE_READINESS'::text, 'UAT'::text, 'GO_LIVE'::text])))`
- `CHECK ((status = ANY (ARRAY['NOT_STARTED'::text, 'IN_PROGRESS'::text, 'DONE'::text, 'SLIPPED'::text])))`

**References:**
- `FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT`
- `FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT`
- `FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE RESTRICT`
- `FOREIGN KEY (co_owner_user_id) REFERENCES users(id) ON DELETE RESTRICT`
- `FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT`
- `FOREIGN KEY (owner_division_id) REFERENCES divisions(id) ON DELETE RESTRICT`

## notification_deliveries

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `notification_id` | bigint | yes |  |
| `channel` | text | no |  |
| `recipient` | text | no |  |
| `payload` | jsonb | no | `'{}'::jsonb` |
| `status` | text | no |  |
| `error` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |

**Rules enforced by the database:**
- `CHECK ((status = ANY (ARRAY['SENT'::text, 'FAILED'::text, 'CAPTURED'::text])))`
- `CHECK ((channel = ANY (ARRAY['EMAIL'::text, 'TEAMS'::text, 'SINK'::text])))`

**References:**
- `FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE RESTRICT`

## notifications

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `user_id` | bigint | no |  |
| `type` | text | no |  |
| `entity` | text | no |  |
| `entity_id` | bigint | no |  |
| `text` | text | no |  |
| `read_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**Rules enforced by the database:**
- `CHECK ((type = ANY (ARRAY['ROADBLOCK_ESCALATED'::text, 'ACTION_ASSIGNED'::text, 'MILESTONE_ASSIGNED'::text, 'PROJECT_RED'::text, 'MEETING_SCHEDULED'::text, 'PM_ASSIGNED'::text, 'SYNC_HALTED'::text, 'REMINDER'::text, 'CHANGE_REQUEST'::text, 'REPORT'::text])))`

**References:**
- `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT`
- `FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT`

## objectives

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `title` | text | no |  |
| `description` | text | yes |  |
| `pillar_id` | bigint | yes |  |
| `owner_user_id` | bigint | yes |  |
| `period` | text | no |  |
| `status` | text | no | `'ACTIVE'::text` |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**Rules enforced by the database:**
- `CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'ACHIEVED'::text, 'DROPPED'::text])))`

**References:**
- `FOREIGN KEY (created_by) REFERENCES users(id)`
- `FOREIGN KEY (pillar_id) REFERENCES strategic_pillars(id) ON DELETE RESTRICT`
- `FOREIGN KEY (owner_user_id) REFERENCES users(id)`

## portfolios

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `title` | text | no |  |
| `description` | text | yes |  |
| `objective` | text | yes |  |
| `pillar_id` | bigint | yes |  |
| `owner_user_id` | bigint | yes |  |
| `horizon_start` | date | yes |  |
| `horizon_end` | date | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**References:**
- `FOREIGN KEY (created_by) REFERENCES users(id)`
- `FOREIGN KEY (pillar_id) REFERENCES strategic_pillars(id) ON DELETE RESTRICT`
- `FOREIGN KEY (owner_user_id) REFERENCES users(id)`

## programs

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `title` | text | no |  |
| `objective` | text | yes |  |
| `portfolio_id` | bigint | no |  |
| `owner_user_id` | bigint | yes |  |
| `horizon_start` | date | yes |  |
| `horizon_end` | date | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**References:**
- `FOREIGN KEY (created_by) REFERENCES users(id)`
- `FOREIGN KEY (owner_user_id) REFERENCES users(id)`
- `FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE RESTRICT`

## project_baselines

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `project_id` | bigint | no |  |
| `version` | integer | no |  |
| `label` | text | no |  |
| `start_date` | date | yes |  |
| `target_date` | date | yes |  |
| `budget_approved` | numeric | yes |  |
| `milestones_json` | jsonb | no | `'[]'::jsonb` |
| `change_request_id` | bigint | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |

**Uniqueness:**
- `UNIQUE (project_id, version)`

**References:**
- `FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT`
- `FOREIGN KEY (created_by) REFERENCES users(id)`
- `FOREIGN KEY (change_request_id) REFERENCES change_requests(id)`

## project_dependencies

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `predecessor_project_id` | bigint | no |  |
| `successor_project_id` | bigint | no |  |
| `note` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**Rules enforced by the database:**
- `CHECK ((predecessor_project_id <> successor_project_id))`

**Uniqueness:**
- `UNIQUE (predecessor_project_id, successor_project_id)`

**References:**
- `FOREIGN KEY (predecessor_project_id) REFERENCES projects(id) ON DELETE RESTRICT`
- `FOREIGN KEY (created_by) REFERENCES users(id)`
- `FOREIGN KEY (successor_project_id) REFERENCES projects(id) ON DELETE RESTRICT`

## project_divisions

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `project_id` | bigint | no |  |
| `division_id` | bigint | no |  |
| `role_in_project` | text | no |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**Rules enforced by the database:**
- `CHECK ((role_in_project = ANY (ARRAY['LEAD'::text, 'ENGAGED'::text, 'CONSULTED'::text])))`

**Uniqueness:**
- `UNIQUE (project_id, division_id)`

**References:**
- `FOREIGN KEY (division_id) REFERENCES divisions(id) ON DELETE RESTRICT`
- `FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT`
- `FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT`

## project_objectives

| Column | Type | Null | Default |
|---|---|---|---|
| `project_id` | bigint | no |  |
| `objective_id` | bigint | no |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |

**References:**
- `FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT`
- `FOREIGN KEY (objective_id) REFERENCES objectives(id) ON DELETE RESTRICT`
- `FOREIGN KEY (created_by) REFERENCES users(id)`

## project_sites

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `project_id` | bigint | no |  |
| `site_id` | bigint | no |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**Uniqueness:**
- `UNIQUE (project_id, site_id)`

**References:**
- `FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT`
- `FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT`
- `FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE RESTRICT`

## project_templates

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `name` | text | no |  |
| `description` | text | yes |  |
| `governance` | text | no | `'STANDARD'::text` |
| `milestones_json` | jsonb | no | `'[]'::jsonb` |
| `workstreams_json` | jsonb | no | `'[]'::jsonb` |
| `deliverables_json` | jsonb | no | `'[]'::jsonb` |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**Rules enforced by the database:**
- `CHECK ((governance = ANY (ARRAY['LITE'::text, 'STANDARD'::text])))`

**References:**
- `FOREIGN KEY (created_by) REFERENCES users(id)`

## projects

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `code` | text | no |  |
| `title` | text | no |  |
| `description` | text | yes |  |
| `lead_division_id` | bigint | no |  |
| `project_manager_id` | bigint | yes |  |
| `sponsor` | text | yes |  |
| `stage` | text | no | `'IDEA'::text` |
| `priority` | text | no | `'P2'::text` |
| `start_date` | date | yes |  |
| `target_date` | date | yes |  |
| `actual_end_date` | date | yes |  |
| `budget_note` | text | yes |  |
| `roadmap_pillar` | text | yes |  |
| `confidential` | boolean | no | `false` |
| `rag_override` | text | yes |  |
| `rag_override_reason` | text | yes |  |
| `exec_commentary` | text | yes |  |
| `rag_computed` | text | no | `'G'::text` |
| `rag_signals_json` | jsonb | no | `'{}'::jsonb` |
| `progress_pct` | integer | no | `0` |
| `last_activity_at` | timestamp with time zone | no | `now()` |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |
| `operating_status` | text | no | `'IN_PROGRESS'::text` |
| `hold_reason` | text | yes |  |
| `cancel_reason` | text | yes |  |
| `portfolio_id` | bigint | yes |  |
| `program_id` | bigint | yes |  |
| `governance` | text | no | `'STANDARD'::text` |
| `demand_id` | bigint | yes |  |
| `custom_json` | jsonb | no | `'{}'::jsonb` |
| `template_id` | bigint | yes |  |
| `progress_method` | text | no | `'MILESTONE'::text` |
| `progress_manual` | integer | yes |  |
| `progress_manual_note` | text | yes |  |
| `calendar_id` | bigint | yes |  |

**Rules enforced by the database:**
- `CHECK (((progress_method <> 'PHYSICAL'::text) OR (progress_manual IS NULL) OR ((progress_manual_note IS NOT NULL) AND (length(btrim(progress_manual_note)) >= 10))))`
- `CHECK (((progress_manual >= 0) AND (progress_manual <= 100)))`
- `CHECK ((progress_method = ANY (ARRAY['MILESTONE'::text, 'TASK'::text, 'EFFORT'::text, 'COST'::text, 'PHYSICAL'::text])))`
- `CHECK ((rag_override = ANY (ARRAY['G'::text, 'A'::text, 'R'::text])))`
- `CHECK ((rag_computed = ANY (ARRAY['G'::text, 'A'::text, 'R'::text])))`
- `CHECK (((rag_override IS NULL) OR (char_length(COALESCE(rag_override_reason, ''::text)) >= 30)))`
- `CHECK ((governance = ANY (ARRAY['LITE'::text, 'STANDARD'::text])))`
- `CHECK ((operating_status = ANY (ARRAY['NOT_STARTED'::text, 'IN_PROGRESS'::text, 'ON_HOLD'::text, 'COMPLETED'::text, 'CANCELLED'::text])))`
- `CHECK ((stage = ANY (ARRAY['IDEA'::text, 'INITIATION'::text, 'PLANNING'::text, 'EXECUTION'::text, 'DEPLOYMENT'::text, 'RUN'::text, 'CLOSED'::text])))`
- `CHECK ((roadmap_pillar = ANY (ARRAY['Network'::text, 'BizPartnering'::text, 'Risk'::text, 'People'::text, 'Other'::text])))`
- `CHECK ((priority = ANY (ARRAY['P1'::text, 'P2'::text, 'P3'::text])))`

**Uniqueness:**
- `UNIQUE (code)`

**References:**
- `FOREIGN KEY (template_id) REFERENCES project_templates(id)`
- `FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE RESTRICT`
- `FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE RESTRICT`
- `FOREIGN KEY (demand_id) REFERENCES demands(id)`
- `FOREIGN KEY (calendar_id) REFERENCES calendars(id)`
- `FOREIGN KEY (project_manager_id) REFERENCES users(id) ON DELETE RESTRICT`
- `FOREIGN KEY (lead_division_id) REFERENCES divisions(id) ON DELETE RESTRICT`
- `FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT`

## raci_assignments

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `deliverable_id` | bigint | no |  |
| `user_id` | bigint | no |  |
| `raci_role` | text | no |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**Rules enforced by the database:**
- `CHECK ((raci_role = ANY (ARRAY['R'::text, 'A'::text, 'C'::text, 'I'::text])))`

**Uniqueness:**
- `UNIQUE (deliverable_id, user_id, raci_role)`

**References:**
- `FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT`
- `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT`
- `FOREIGN KEY (deliverable_id) REFERENCES deliverables(id) ON DELETE RESTRICT`

## rag_history

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `project_id` | bigint | no |  |
| `snapshot_date` | date | no |  |
| `rag` | text | no |  |
| `progress_pct` | integer | no | `0` |
| `created_at` | timestamp with time zone | no | `now()` |

**Rules enforced by the database:**
- `CHECK ((rag = ANY (ARRAY['G'::text, 'A'::text, 'R'::text])))`

**Uniqueness:**
- `UNIQUE (project_id, snapshot_date)`

**References:**
- `FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT`

## readiness_items

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `milestone_id` | bigint | no |  |
| `label` | text | no |  |
| `checked` | boolean | no | `false` |
| `checked_by` | bigint | yes |  |
| `checked_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**References:**
- `FOREIGN KEY (checked_by) REFERENCES users(id) ON DELETE RESTRICT`
- `FOREIGN KEY (milestone_id) REFERENCES milestones(id) ON DELETE RESTRICT`
- `FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT`

## reminder_log

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `entity` | text | no |  |
| `entity_id` | bigint | no |  |
| `threshold` | text | no |  |
| `user_id` | bigint | no |  |
| `created_at` | timestamp with time zone | no | `now()` |

**Rules enforced by the database:**
- `CHECK ((threshold = ANY (ARRAY['T-14'::text, 'T-7'::text, 'T-2'::text, 'T0'::text, 'T+1'::text, 'T+7'::text])))`

**Uniqueness:**
- `UNIQUE (entity, entity_id, threshold, user_id)`

**References:**
- `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT`

## report_dispatch_log

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `report_key` | text | no |  |
| `period` | text | no |  |
| `user_id` | bigint | no |  |
| `summary` | text | no |  |
| `created_at` | timestamp with time zone | no | `now()` |

**Uniqueness:**
- `UNIQUE (report_key, period, user_id)`

**References:**
- `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT`

## resource_allocations

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `project_id` | bigint | yes |  |
| `workstream_id` | bigint | yes |  |
| `user_id` | bigint | no |  |
| `start_date` | date | no |  |
| `end_date` | date | no |  |
| `percent` | integer | no |  |
| `role` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |
| `allocation_type` | text | no | `'PROJECT'::text` |
| `commitment` | text | no | `'COMMITTED'::text` |

**Rules enforced by the database:**
- `CHECK ((end_date >= start_date))`
- `CHECK (((allocation_type <> 'PROJECT'::text) OR (project_id IS NOT NULL)))`
- `CHECK (((percent >= 1) AND (percent <= 100)))`
- `CHECK ((commitment = ANY (ARRAY['COMMITTED'::text, 'TENTATIVE'::text])))`
- `CHECK ((allocation_type = ANY (ARRAY['PROJECT'::text, 'BAU'::text, 'LEAVE'::text])))`

**References:**
- `FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT`
- `FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT`
- `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT`
- `FOREIGN KEY (workstream_id) REFERENCES workstreams(id) ON DELETE RESTRICT`

## resource_requests

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `project_id` | bigint | no |  |
| `role` | text | no |  |
| `skill_id` | bigint | yes |  |
| `min_proficiency` | integer | yes |  |
| `percent` | integer | no |  |
| `start_date` | date | no |  |
| `end_date` | date | no |  |
| `site_id` | bigint | yes |  |
| `notes` | text | yes |  |
| `status` | text | no | `'PENDING'::text` |
| `fulfilled_user_id` | bigint | yes |  |
| `allocation_id` | bigint | yes |  |
| `decided_by` | bigint | yes |  |
| `decided_at` | timestamp with time zone | yes |  |
| `decision_note` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**Rules enforced by the database:**
- `CHECK ((end_date >= start_date))`
- `CHECK (((min_proficiency >= 1) AND (min_proficiency <= 5)))`
- `CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'FILLED'::text])))`
- `CHECK (((percent >= 1) AND (percent <= 100)))`

**References:**
- `FOREIGN KEY (allocation_id) REFERENCES resource_allocations(id)`
- `FOREIGN KEY (decided_by) REFERENCES users(id)`
- `FOREIGN KEY (fulfilled_user_id) REFERENCES users(id)`
- `FOREIGN KEY (project_id) REFERENCES projects(id)`
- `FOREIGN KEY (skill_id) REFERENCES skills(id)`
- `FOREIGN KEY (site_id) REFERENCES sites(id)`
- `FOREIGN KEY (created_by) REFERENCES users(id)`

## risks

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `project_id` | bigint | no |  |
| `title` | text | no |  |
| `description` | text | yes |  |
| `category` | text | no | `'OTHER'::text` |
| `probability` | integer | no |  |
| `impact` | integer | no |  |
| `score` | integer | yes |  |
| `treatment` | text | yes |  |
| `owner_user_id` | bigint | yes |  |
| `target_date` | date | yes |  |
| `residual_probability` | integer | yes |  |
| `residual_impact` | integer | yes |  |
| `status` | text | no | `'OPEN'::text` |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**Rules enforced by the database:**
- `CHECK (((residual_probability >= 1) AND (residual_probability <= 5)))`
- `CHECK ((category = ANY (ARRAY['TECHNICAL'::text, 'SECURITY'::text, 'SCHEDULE'::text, 'FINANCIAL'::text, 'RESOURCE'::text, 'VENDOR'::text, 'OPERATIONAL'::text, 'OTHER'::text])))`
- `CHECK (((probability >= 1) AND (probability <= 5)))`
- `CHECK (((impact >= 1) AND (impact <= 5)))`
- `CHECK ((treatment = ANY (ARRAY['AVOID'::text, 'MITIGATE'::text, 'TRANSFER'::text, 'ACCEPT'::text])))`
- `CHECK (((residual_impact >= 1) AND (residual_impact <= 5)))`
- `CHECK ((status = ANY (ARRAY['OPEN'::text, 'MITIGATING'::text, 'CLOSED'::text, 'REALISED'::text])))`

**References:**
- `FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT`
- `FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT`
- `FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT`

## roadblocks

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `project_id` | bigint | no |  |
| `title` | text | no |  |
| `description` | text | yes |  |
| `severity` | text | no |  |
| `owner_user_id` | bigint | yes |  |
| `raised_by_division_id` | bigint | yes |  |
| `due_date` | date | yes |  |
| `status` | text | no | `'OPEN'::text` |
| `resolution_note` | text | yes |  |
| `escalated_to` | bigint | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |
| `reopen_reason` | text | yes |  |

**Rules enforced by the database:**
- `CHECK ((status = ANY (ARRAY['OPEN'::text, 'IN_PROGRESS'::text, 'RESOLVED'::text, 'ESCALATED'::text])))`
- `CHECK ((severity = ANY (ARRAY['CRITICAL'::text, 'MAJOR'::text, 'MINOR'::text])))`

**References:**
- `FOREIGN KEY (raised_by_division_id) REFERENCES divisions(id) ON DELETE RESTRICT`
- `FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT`
- `FOREIGN KEY (escalated_to) REFERENCES users(id) ON DELETE RESTRICT`
- `FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT`
- `FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT`

## scenarios

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `title` | text | no |  |
| `description` | text | yes |  |
| `moves_json` | jsonb | no | `'[]'::jsonb` |
| `status` | text | no | `'DRAFT'::text` |
| `decided_by` | bigint | yes |  |
| `decided_at` | timestamp with time zone | yes |  |
| `decision_note` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**Rules enforced by the database:**
- `CHECK ((status = ANY (ARRAY['DRAFT'::text, 'APPROVED'::text, 'REJECTED'::text, 'PROMOTED'::text])))`

**References:**
- `FOREIGN KEY (created_by) REFERENCES users(id)`
- `FOREIGN KEY (decided_by) REFERENCES users(id)`

## sequences

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `name` | text | no |  |
| `next_value` | bigint | no | `1` |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**Uniqueness:**
- `UNIQUE (name)`

**References:**
- `FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT`

## sites

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `code` | text | no |  |
| `name` | text | no |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**Uniqueness:**
- `UNIQUE (code)`

**References:**
- `FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT`

## skills

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `name` | text | no |  |
| `category` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**References:**
- `FOREIGN KEY (created_by) REFERENCES users(id)`

## stage_transitions

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `project_id` | bigint | no |  |
| `from_stage` | text | no |  |
| `to_stage` | text | no |  |
| `approved_by` | bigint | no |  |
| `note` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |

**References:**
- `FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT`
- `FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE RESTRICT`

## status_updates

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `project_id` | bigint | no |  |
| `date` | date | no | `((now() AT TIME ZONE 'utc'::text))::date` |
| `author_id` | bigint | no |  |
| `mood` | text | no |  |
| `summary` | text | no |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**Rules enforced by the database:**
- `CHECK ((mood = ANY (ARRAY['ON_TRACK'::text, 'WATCH'::text, 'AT_RISK'::text])))`
- `CHECK ((char_length(summary) <= 400))`

**References:**
- `FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT`
- `FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE RESTRICT`
- `FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT`

## strategic_pillars

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `name` | text | no |  |
| `description` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**References:**
- `FOREIGN KEY (created_by) REFERENCES users(id)`

## sync_ops

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `op_id` | text | no |  |
| `user_id` | bigint | yes |  |
| `method` | text | no |  |
| `path` | text | no |  |
| `status_code` | integer | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `body_hash` | character | yes |  |

**References:**
- `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT`

## task_baselines

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `project_id` | bigint | no |  |
| `version` | integer | no |  |
| `label` | text | no |  |
| `tasks_json` | jsonb | no |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |

**Uniqueness:**
- `UNIQUE (project_id, version)`

**References:**
- `FOREIGN KEY (created_by) REFERENCES users(id)`
- `FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT`

## task_dependencies

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `predecessor_task_id` | bigint | no |  |
| `successor_task_id` | bigint | no |  |
| `dep_type` | text | no | `'FS'::text` |
| `lag_days` | integer | no | `0` |
| `created_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**Rules enforced by the database:**
- `CHECK ((predecessor_task_id <> successor_task_id))`
- `CHECK ((dep_type = ANY (ARRAY['FS'::text, 'SS'::text, 'FF'::text, 'SF'::text])))`

**Uniqueness:**
- `UNIQUE (predecessor_task_id, successor_task_id)`

**References:**
- `FOREIGN KEY (predecessor_task_id) REFERENCES tasks(id) ON DELETE RESTRICT`
- `FOREIGN KEY (successor_task_id) REFERENCES tasks(id) ON DELETE RESTRICT`
- `FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT`

## tasks

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `project_id` | bigint | no |  |
| `workstream_id` | bigint | yes |  |
| `milestone_id` | bigint | yes |  |
| `title` | text | no |  |
| `description` | text | yes |  |
| `owner_user_id` | bigint | yes |  |
| `planned_start` | date | yes |  |
| `planned_finish` | date | yes |  |
| `actual_start` | date | yes |  |
| `actual_finish` | date | yes |  |
| `estimated_hours` | numeric | yes |  |
| `actual_hours` | numeric | yes |  |
| `priority` | text | no | `'P2'::text` |
| `status` | text | no | `'NOT_STARTED'::text` |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |
| `parent_task_id` | bigint | yes |  |
| `remaining_hours` | numeric | yes |  |
| `constraint_type` | text | no | `'ASAP'::text` |
| `constraint_date` | date | yes |  |

**Rules enforced by the database:**
- `CHECK (((planned_finish IS NULL) OR (planned_start IS NULL) OR (planned_finish >= planned_start)))`
- `CHECK (((constraint_type = 'ASAP'::text) OR (constraint_date IS NOT NULL)))`
- `CHECK ((constraint_type = ANY (ARRAY['ASAP'::text, 'START_NO_EARLIER_THAN'::text, 'FINISH_NO_LATER_THAN'::text, 'MUST_START_ON'::text, 'MUST_FINISH_ON'::text])))`
- `CHECK (((estimated_hours IS NULL) OR (estimated_hours >= (0)::numeric)))`
- `CHECK (((actual_hours IS NULL) OR (actual_hours >= (0)::numeric)))`
- `CHECK ((priority = ANY (ARRAY['P1'::text, 'P2'::text, 'P3'::text])))`
- `CHECK (((remaining_hours IS NULL) OR (remaining_hours >= (0)::numeric)))`
- `CHECK ((status = ANY (ARRAY['NOT_STARTED'::text, 'IN_PROGRESS'::text, 'BLOCKED'::text, 'DONE'::text, 'CANCELLED'::text])))`

**References:**
- `FOREIGN KEY (milestone_id) REFERENCES milestones(id) ON DELETE RESTRICT`
- `FOREIGN KEY (workstream_id) REFERENCES workstreams(id) ON DELETE RESTRICT`
- `FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT`
- `FOREIGN KEY (parent_task_id) REFERENCES tasks(id) ON DELETE RESTRICT`
- `FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT`
- `FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT`

## time_entries

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `user_id` | bigint | no |  |
| `project_id` | bigint | no |  |
| `workstream_id` | bigint | yes |  |
| `task_id` | bigint | yes |  |
| `entry_date` | date | no |  |
| `hours` | numeric | no |  |
| `description` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**Rules enforced by the database:**
- `CHECK (((hours > (0)::numeric) AND (hours <= (24)::numeric)))`

**References:**
- `FOREIGN KEY (workstream_id) REFERENCES workstreams(id) ON DELETE RESTRICT`
- `FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT`
- `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT`
- `FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT`
- `FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE RESTRICT`

## user_skills

| Column | Type | Null | Default |
|---|---|---|---|
| `user_id` | bigint | no |  |
| `skill_id` | bigint | no |  |
| `proficiency` | integer | no |  |
| `years_experience` | numeric | yes |  |
| `certified` | boolean | no | `false` |
| `certification_name` | text | yes |  |
| `certification_expires` | date | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |

**Rules enforced by the database:**
- `CHECK ((years_experience >= (0)::numeric))`
- `CHECK (((proficiency >= 1) AND (proficiency <= 5)))`

**References:**
- `FOREIGN KEY (skill_id) REFERENCES skills(id)`
- `FOREIGN KEY (user_id) REFERENCES users(id)`
- `FOREIGN KEY (created_by) REFERENCES users(id)`

## users

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `name` | text | no |  |
| `email` | text | no |  |
| `password_hash` | text | no |  |
| `role` | text | no |  |
| `division_id` | bigint | yes |  |
| `site_id` | bigint | yes |  |
| `active` | boolean | no | `true` |
| `must_change_password` | boolean | no | `true` |
| `failed_logins` | integer | no | `0` |
| `locked_until` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |
| `is_steering_committee` | boolean | no | `false` |
| `enterprise_access` | boolean | no | `true` |
| `finance_access` | boolean | no | `false` |

**Rules enforced by the database:**
- `CHECK ((role = ANY (ARRAY['ADMIN'::text, 'DIVISION_LEAD'::text, 'CONTRIBUTOR'::text, 'VIEWER'::text])))`

**References:**
- `FOREIGN KEY (division_id) REFERENCES divisions(id) ON DELETE RESTRICT`
- `FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE RESTRICT`
- `FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT`

## webhook_deliveries

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `subscription_id` | bigint | no |  |
| `event` | text | no |  |
| `payload_json` | jsonb | no |  |
| `status` | text | no | `'PENDING'::text` |
| `attempts` | integer | no | `0` |
| `next_attempt_at` | timestamp with time zone | no | `now()` |
| `last_error` | text | yes |  |
| `delivered_at` | timestamp with time zone | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |

**Rules enforced by the database:**
- `CHECK ((status = ANY (ARRAY['PENDING'::text, 'FAILED'::text, 'DELIVERED'::text, 'DEAD'::text])))`

**References:**
- `FOREIGN KEY (subscription_id) REFERENCES webhook_subscriptions(id)`

## webhook_subscriptions

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `url` | text | no |  |
| `secret` | text | no |  |
| `events` | ARRAY | no | `'{}'::text[]` |
| `active` | boolean | no | `true` |
| `description` | text | yes |  |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**References:**
- `FOREIGN KEY (created_by) REFERENCES users(id)`

## workstreams

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no |  |
| `project_id` | bigint | no |  |
| `title` | text | no |  |
| `description` | text | yes |  |
| `lead_user_id` | bigint | yes |  |
| `start_date` | date | yes |  |
| `end_date` | date | yes |  |
| `status` | text | no | `'NOT_STARTED'::text` |
| `created_at` | timestamp with time zone | no | `now()` |
| `updated_at` | timestamp with time zone | no | `now()` |
| `created_by` | bigint | yes |  |
| `deleted_at` | timestamp with time zone | yes |  |

**Rules enforced by the database:**
- `CHECK (((end_date IS NULL) OR (start_date IS NULL) OR (end_date >= start_date)))`
- `CHECK ((status = ANY (ARRAY['NOT_STARTED'::text, 'IN_PROGRESS'::text, 'DONE'::text, 'CANCELLED'::text])))`

**References:**
- `FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT`
- `FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT`
- `FOREIGN KEY (lead_user_id) REFERENCES users(id) ON DELETE RESTRICT`
