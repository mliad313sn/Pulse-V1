-- SPM Phase 8 — Meeting Mode 2.0: a captured decision can be converted into
-- a governed change request. The link is recorded on the decision so the
-- meeting record, the decision graph and the UI can show the conversion —
-- and so a decision is never converted twice.
ALTER TABLE decisions ADD COLUMN change_request_id bigint REFERENCES change_requests(id);
CREATE INDEX decisions_change_request_id_idx ON decisions (change_request_id);
