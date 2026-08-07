-- SPM Phase 10 — correction to 028.
-- Unlinking is a SOFT delete, but the table-level UNIQUE constraints counted
-- deleted rows, so a record could never be re-linked after being unlinked
-- (deliberate re-pointing, the one path the design does allow, failed with a
-- constraint violation). Replace both with partial unique indexes that apply
-- only to live links. No data is touched.
ALTER TABLE external_links DROP CONSTRAINT external_links_system_external_id_entity_key;
ALTER TABLE external_links DROP CONSTRAINT external_links_system_entity_entity_id_key;

CREATE UNIQUE INDEX external_links_source_ux
  ON external_links (system, external_id, entity) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX external_links_target_ux
  ON external_links (system, entity, entity_id) WHERE deleted_at IS NULL;
