-- PULSE ↔ SDP integration, PHASE 0 — canonical seed and the full alias map.
--
-- Every alias below was observed in the sdp_dashboard dump. They are seeded as
-- data, not code, because they are evidence: an auditor asking "why did this
-- ticket count against Ity?" gets a row with a system and a spelling.
--
-- TWO CANONICAL CODES ARE PROVISIONAL AND BLOCK GATE 0 (decision Q1):
--   * Ity appears as ITY (tracker, tickets), SMI (inspection, meetings) and
--     IGO (risk register). Seeded as ITY.
--   * Ouagadougou appears as OUA (inspection, meetings), EDV (tracker) and
--     OUAGA OFF1 (risk register). Seeded as OUA.
-- Aliases are permanent, so if the business chooses differently the canonical
-- code must be changed BEFORE any fact table is built on it.

-- ===== canonical sites =====
INSERT INTO emid.site (code, name, country, site_type, in_scope, active) VALUES
  ('SGO',     'Sabodala-Massawa',  'SN', 'MINE',        true,  true),
  ('MGO',     'Mana',              'BF', 'MINE',        true,  true),
  ('HGO',     'Houndé',            'BF', 'MINE',        true,  true),
  ('ITY',     'Ity',               'CI', 'MINE',        true,  true),
  ('SML',     'Lafigué',           'CI', 'MINE',        true,  true),
  ('KGO',     'Kalana',            'ML', 'MINE',        true,  true),
  ('MASSAWA', 'Massawa',           'SN', 'MINE',        true,  true),
  ('OUA',     'Ouagadougou',       'BF', 'OFFICE',      true,  true),
  ('ABJ',     'Abidjan',           'CI', 'OFFICE',      true,  true),
  ('DKR',     'Dakar',             'SN', 'OFFICE',      true,  true),
  ('TND',     'Tanda',             'CI', 'OFFICE',      true,  true),
  ('ASSAFO',  'Assafo',            'CI', 'EXPLORATION', true,  true),
  ('EXPLO',   'Exploration',       NULL, 'EXPLORATION', true,  true),
  ('GROUP',   'Group IT',          NULL, 'CORPORATE',   true,  true),
  -- Q2 (BLOCKING): 23,508 tickets (41% of all history) carry a corporate label.
  -- Seeded OUT of scope so no group denominator silently absorbs them. Flip to
  -- true the moment the business decides otherwise.
  ('CORPORATE','Corporate offices', NULL, 'CORPORATE',  false, true),
  -- divested
  ('WAHGNION','Wahgnion',          'BF', 'MINE',        false, false),
  -- Everything unmapped lands here and stays VISIBLE. Never drop a row.
  ('UNMAPPED','Unmapped / not a site', NULL, 'CORPORATE', false, true)
ON CONFLICT (code) DO NOTHING;

-- ===== org units =====
INSERT INTO emid.org_unit (code, name) VALUES
  ('INF','Infrastructure'), ('OPS','Operations'), ('BAP','Business Apps'),
  ('DAT','Data Insight'),   ('SEC','Information Security'),
  ('EAR','Enterprise Architecture'), ('GRP','Group IT')
ON CONFLICT (code) DO NOTHING;

-- ===== SDP_TECH_GROUP → site =====
-- This is the workload attribution key: who did the work, not where the
-- requester sat. Getting this wrong mis-attributes every capacity number.
INSERT INTO emid.site_alias (system, alias, code, note) VALUES
  ('SDP_TECH_GROUP','Sabodala IT Agents','SGO',NULL),
  ('SDP_TECH_GROUP','Hounde IT Agents','HGO',NULL),
  ('SDP_TECH_GROUP','ITY IT Agents','ITY',NULL),
  ('SDP_TECH_GROUP','Lafigue IT Agents','SML',NULL),
  ('SDP_TECH_GROUP','Mana IT Agent','MGO','singular spelling'),
  ('SDP_TECH_GROUP','Mana IT Agents','MGO','plural spelling — same group'),
  ('SDP_TECH_GROUP','Kalana IT Agents','KGO','single technician — SPOF'),
  ('SDP_TECH_GROUP','Abidjan IT Agents','ABJ',NULL),
  ('SDP_TECH_GROUP','Ouaga IT Agents','OUA',NULL),
  ('SDP_TECH_GROUP','Tanda IT Agents','TND','also covers ASSAFO tickets'),
  ('SDP_TECH_GROUP','Exploration IT Support','EXPLO',NULL),
  ('SDP_TECH_GROUP','Exploration BF Support','EXPLO',NULL),
  ('SDP_TECH_GROUP','Exploration CI Support','EXPLO',NULL),
  ('SDP_TECH_GROUP','IT Agents','GROUP',NULL),
  -- cross-site application and function groups: no site, but a real division
  ('SDP_TECH_GROUP','ERP Support','GROUP','Q5 (blocking): largest group, 8,605 tickets — site attribution undecided'),
  ('SDP_TECH_GROUP','My Path Support Agents','GROUP',NULL),
  ('SDP_TECH_GROUP','Ivalua Support Team','GROUP',NULL),
  ('SDP_TECH_GROUP','Oracle Support','GROUP',NULL),
  ('SDP_TECH_GROUP','Benchmark Support Team','GROUP',NULL),
  ('SDP_TECH_GROUP','Benchmark Support team','GROUP','casing variant'),
  ('SDP_TECH_GROUP','EDV Academy Team','GROUP','Q7 (blocking): 261 open, median age 330 days'),
  ('SDP_TECH_GROUP','EDV SharePoint Support','GROUP',NULL),
  ('SDP_TECH_GROUP','EDV InfraOPs Support','GROUP',NULL),
  ('SDP_TECH_GROUP','SAP Support Agents','GROUP',NULL),
  ('SDP_TECH_GROUP','Sage X3 Support','GROUP',NULL),
  ('SDP_TECH_GROUP','CELOXIS Support Agents','GROUP',NULL),
  ('SDP_TECH_GROUP','EQS ONEIT Support Agents','GROUP',NULL),
  ('SDP_TECH_GROUP','ManageEngine ServiceDesk Plus','GROUP',NULL),
  ('SDP_TECH_GROUP','SunShine Project Team','GROUP',NULL),
  ('SDP_TECH_GROUP','HR','GROUP',NULL),
  ('SDP_TECH_GROUP','infosec team','GROUP','three casings, one group'),
  ('SDP_TECH_GROUP','Infosec team','GROUP','three casings, one group'),
  ('SDP_TECH_GROUP','Infosec Team','GROUP','three casings, one group'),
  ('SDP_TECH_GROUP','CAB Agents','GROUP',NULL)
ON CONFLICT (system, alias) DO NOTHING;

-- ===== SDP_TECH_GROUP → division =====
INSERT INTO emid.org_alias (system, alias, code) VALUES
  ('SDP_TECH_GROUP','Sabodala IT Agents','OPS'),
  ('SDP_TECH_GROUP','Hounde IT Agents','OPS'),
  ('SDP_TECH_GROUP','ITY IT Agents','OPS'),
  ('SDP_TECH_GROUP','Lafigue IT Agents','OPS'),
  ('SDP_TECH_GROUP','Mana IT Agent','OPS'),
  ('SDP_TECH_GROUP','Mana IT Agents','OPS'),
  ('SDP_TECH_GROUP','Kalana IT Agents','OPS'),
  ('SDP_TECH_GROUP','Abidjan IT Agents','OPS'),
  ('SDP_TECH_GROUP','Ouaga IT Agents','OPS'),
  ('SDP_TECH_GROUP','Tanda IT Agents','OPS'),
  ('SDP_TECH_GROUP','Exploration IT Support','OPS'),
  ('SDP_TECH_GROUP','Exploration BF Support','OPS'),
  ('SDP_TECH_GROUP','Exploration CI Support','OPS'),
  ('SDP_TECH_GROUP','IT Agents','OPS'),
  ('SDP_TECH_GROUP','ERP Support','BAP'),
  ('SDP_TECH_GROUP','My Path Support Agents','BAP'),
  ('SDP_TECH_GROUP','Ivalua Support Team','BAP'),
  ('SDP_TECH_GROUP','Oracle Support','BAP'),
  ('SDP_TECH_GROUP','Benchmark Support Team','BAP'),
  ('SDP_TECH_GROUP','Benchmark Support team','BAP'),
  ('SDP_TECH_GROUP','EDV Academy Team','BAP'),
  ('SDP_TECH_GROUP','EDV SharePoint Support','BAP'),
  ('SDP_TECH_GROUP','SAP Support Agents','BAP'),
  ('SDP_TECH_GROUP','Sage X3 Support','BAP'),
  ('SDP_TECH_GROUP','CELOXIS Support Agents','BAP'),
  ('SDP_TECH_GROUP','EQS ONEIT Support Agents','BAP'),
  ('SDP_TECH_GROUP','SunShine Project Team','BAP'),
  ('SDP_TECH_GROUP','infosec team','SEC'),
  ('SDP_TECH_GROUP','Infosec team','SEC'),
  ('SDP_TECH_GROUP','Infosec Team','SEC'),
  ('SDP_TECH_GROUP','EDV InfraOPs Support','INF'),
  ('SDP_TECH_GROUP','CAB Agents','GRP'),
  ('SDP_TECH_GROUP','ManageEngine ServiceDesk Plus','GRP'),
  ('SDP_TECH_GROUP','HR','GRP')
ON CONFLICT (system, alias) DO NOTHING;

-- ===== module codes: tracker / inspection / meetings / risk register =====
INSERT INTO emid.site_alias (system, alias, code, note) VALUES
  ('TRACKER','SGO','SGO',NULL), ('TRACKER','MGO','MGO',NULL), ('TRACKER','HGO','HGO',NULL),
  ('TRACKER','ITY','ITY',NULL), ('TRACKER','SML','SML',NULL), ('TRACKER','ABJ','ABJ',NULL),
  ('TRACKER','DKR','DKR',NULL), ('TRACKER','KLN','KGO','tracker spells Kalana KLN'),
  ('TRACKER','EDV','OUA','tracker spells Ouagadougou EDV — Q1'),
  ('TRACKER','EXP','EXPLO',NULL), ('TRACKER','TND','TND',NULL),

  ('INSPECTION','SGO','SGO',NULL), ('INSPECTION','MGO','MGO',NULL), ('INSPECTION','HGO','HGO',NULL),
  ('INSPECTION','SMI','ITY','inspection spells Ity SMI — Q1'),
  ('INSPECTION','SML','SML',NULL), ('INSPECTION','OUA','OUA',NULL),
  ('INSPECTION','ABJ','ABJ',NULL), ('INSPECTION','DKR','DKR',NULL),
  ('INSPECTION','KGO','KGO',NULL),

  ('MEETINGS','SGO','SGO',NULL), ('MEETINGS','MGO','MGO',NULL), ('MEETINGS','HGO','HGO',NULL),
  ('MEETINGS','SMI','ITY','meetings spell Ity SMI — Q1'),
  ('MEETINGS','SML','SML',NULL), ('MEETINGS','OUA','OUA',NULL),
  ('MEETINGS','ABJ','ABJ',NULL), ('MEETINGS','DKR','DKR',NULL),
  ('MEETINGS','KGO','KGO',NULL),

  ('RISK_REGISTER','SGO','SGO',NULL), ('RISK_REGISTER','MGO','MGO',NULL),
  ('RISK_REGISTER','HGO','HGO',NULL),
  ('RISK_REGISTER','IGO','ITY','risk register spells Ity IGO — Q1'),
  ('RISK_REGISTER','SML','SML',NULL),
  ('RISK_REGISTER','OUAGA OFF1','OUA','risk register spelling — Q1'),
  ('RISK_REGISTER','KGO','KGO',NULL), ('RISK_REGISTER','EXPLO','EXPLO',NULL),
  ('RISK_REGISTER','MASSAWA','MASSAWA',NULL),

  ('SDP_SITES_NAME','Sabodala','SGO',NULL), ('SDP_SITES_NAME','MANA','MGO',NULL),
  ('SDP_SITES_NAME','Hounde','HGO',NULL),   ('SDP_SITES_NAME','Ity','ITY',NULL),
  ('SDP_SITES_NAME','Lafigue','SML',NULL),  ('SDP_SITES_NAME','Kalana','KGO',NULL),
  ('SDP_SITES_NAME','Ouagadougou','OUA',NULL), ('SDP_SITES_NAME','Abidjan','ABJ',NULL),
  ('SDP_SITES_NAME','Dakar','DKR',NULL),    ('SDP_SITES_NAME','Exploration','EXPLO',NULL),
  ('SDP_SITES_NAME','Tanda','TND',NULL),    ('SDP_SITES_NAME','ASSAFO','ASSAFO',NULL),
  ('SDP_SITES_NAME','Wahgnion','WAHGNION','divested'),

  ('PULSE','SGO','SGO',NULL), ('PULSE','HGO','HGO',NULL), ('PULSE','ITY','ITY',NULL),
  ('PULSE','SML','SML',NULL), ('PULSE','MGO','MGO',NULL), ('PULSE','KGO','KGO',NULL),
  ('PULSE','DKR','DKR',NULL), ('PULSE','ABJ','ABJ',NULL), ('PULSE','OUA','OUA',NULL),
  ('PULSE','GROUP','GROUP',NULL), ('PULSE','EXPLO','EXPLO',NULL), ('PULSE','TND','TND',NULL),
  ('PULSE','ASSAFO','ASSAFO',NULL), ('PULSE','MASSAWA','MASSAWA',NULL)
ON CONFLICT (system, alias) DO NOTHING;

-- ===== SDP_TICKET_LABEL → site =====
-- Free text, 120+ observed values. High-volume spellings are seeded explicitly;
-- the resolution job applies prefix rules to the tail and queues the remainder.
-- Requester location, NOT the workload key — kept for reporting only.
INSERT INTO emid.site_alias (system, alias, code, note) VALUES
  ('SDP_TICKET_LABEL','London','CORPORATE',NULL),
  ('SDP_TICKET_LABEL','LONDON','CORPORATE',NULL),
  ('SDP_TICKET_LABEL','London Office','CORPORATE',NULL),
  ('SDP_TICKET_LABEL','Endeavour Management Services London','CORPORATE',NULL),
  ('SDP_TICKET_LABEL','MONTREAL','CORPORATE',NULL),
  ('SDP_TICKET_LABEL','MONACO','CORPORATE',NULL),
  ('SDP_TICKET_LABEL','Paris','CORPORATE',NULL),
  ('SDP_TICKET_LABEL','Corporate Office','CORPORATE',NULL),

  ('SDP_TICKET_LABEL','ITY','ITY',NULL),
  ('SDP_TICKET_LABEL','SMI','ITY',NULL),
  ('SDP_TICKET_LABEL','SMI Ity','ITY',NULL),
  ('SDP_TICKET_LABEL','ITY GOLD MINE','ITY',NULL),
  ('SDP_TICKET_LABEL','ITY  GOLD MINE','ITY','double space in source'),
  ('SDP_TICKET_LABEL','ITY Gold','ITY',NULL),
  ('SDP_TICKET_LABEL','IGO','ITY',NULL),
  ('SDP_TICKET_LABEL','Ity Exploration Office','ITY',NULL),
  ('SDP_TICKET_LABEL','ITY Exploration','ITY',NULL),
  ('SDP_TICKET_LABEL','EDVA - Ity Site','ITY',NULL),

  ('SDP_TICKET_LABEL','MANA','MGO',NULL),
  ('SDP_TICKET_LABEL','MANA Admin Building room','MGO',NULL),
  ('SDP_TICKET_LABEL','Mana Gold Operations','MGO',NULL),
  ('SDP_TICKET_LABEL','Mana Gold Operation','MGO',NULL),
  ('SDP_TICKET_LABEL','Mana Gold Mine','MGO',NULL),
  ('SDP_TICKET_LABEL','Mana Office','MGO',NULL),
  ('SDP_TICKET_LABEL','Mana Exploration','MGO',NULL),
  ('SDP_TICKET_LABEL','Mana Exploration Office','MGO',NULL),

  ('SDP_TICKET_LABEL','Sabodala','SGO',NULL),
  ('SDP_TICKET_LABEL','Sabodala Admin Building','SGO',NULL),
  ('SDP_TICKET_LABEL','Sabodala Gold Operations','SGO',NULL),
  ('SDP_TICKET_LABEL','Sabodala Warehouse','SGO',NULL),
  ('SDP_TICKET_LABEL','Sabodala Process Plant','SGO',NULL),
  ('SDP_TICKET_LABEL','Sabodala Mining Ops Office','SGO',NULL),

  ('SDP_TICKET_LABEL','Massawa','MASSAWA',NULL),
  ('SDP_TICKET_LABEL','MASSAWA','MASSAWA',NULL),
  ('SDP_TICKET_LABEL','Massawa Camp','MASSAWA',NULL),
  ('SDP_TICKET_LABEL','Massawa Office','MASSAWA',NULL),
  ('SDP_TICKET_LABEL','Massawa Exploration Camp','MASSAWA',NULL),
  ('SDP_TICKET_LABEL','SGO Massawa Office','MASSAWA',NULL),

  ('SDP_TICKET_LABEL','LAFIGUE','SML',NULL),
  ('SDP_TICKET_LABEL','LAFIGUE - SML','SML',NULL),
  ('SDP_TICKET_LABEL','SML','SML',NULL),
  ('SDP_TICKET_LABEL','SML - Lafigue','SML',NULL),
  ('SDP_TICKET_LABEL','SML Lafigue','SML',NULL),
  ('SDP_TICKET_LABEL','Lafigue Site','SML',NULL),
  ('SDP_TICKET_LABEL','Lafigue Project','SML',NULL),
  ('SDP_TICKET_LABEL','SML - DABAKALA','SML',NULL),

  ('SDP_TICKET_LABEL','HOUNDE','HGO',NULL),
  ('SDP_TICKET_LABEL','Hounde Mine','HGO',NULL),
  ('SDP_TICKET_LABEL','Hounde Gold Operation','HGO',NULL),
  ('SDP_TICKET_LABEL','Houndé Gold Mine','HGO',NULL),
  ('SDP_TICKET_LABEL','HGO-Mining','HGO',NULL),
  ('SDP_TICKET_LABEL','Hounde Exploration','HGO',NULL),
  ('SDP_TICKET_LABEL','Houndé Exploration office','HGO',NULL),
  ('SDP_TICKET_LABEL','Houndé Explo','HGO',NULL),

  ('SDP_TICKET_LABEL','ABIDJAN','ABJ',NULL),
  ('SDP_TICKET_LABEL','Abidjan Office','ABJ',NULL),
  ('SDP_TICKET_LABEL','Abidjan Regional Office','ABJ',NULL),
  ('SDP_TICKET_LABEL','Abidjan - Regional Office','ABJ',NULL),
  ('SDP_TICKET_LABEL','EMSA Abidjan','ABJ',NULL),
  ('SDP_TICKET_LABEL','EMSA - Abidjan','ABJ',NULL),
  ('SDP_TICKET_LABEL','EMSA','ABJ',NULL),
  ('SDP_TICKET_LABEL','EDVA-ABJ','ABJ',NULL),
  ('SDP_TICKET_LABEL','EDVA','ABJ',NULL),
  ('SDP_TICKET_LABEL','Regional Office - Abidjan','ABJ',NULL),
  ('SDP_TICKET_LABEL','REGIONAL Office','ABJ',NULL),
  ('SDP_TICKET_LABEL','Bureau regional','ABJ',NULL),
  ('SDP_TICKET_LABEL','Abidjan - Airport','ABJ',NULL),
  ('SDP_TICKET_LABEL','Abidjan Officer','ABJ',NULL),
  ('SDP_TICKET_LABEL','Endeavour Management Services Abidjan','ABJ',NULL),

  ('SDP_TICKET_LABEL','Ouagadougou','OUA',NULL),
  ('SDP_TICKET_LABEL','Ouaga','OUA',NULL),
  ('SDP_TICKET_LABEL','Ouaga Office','OUA',NULL),
  ('SDP_TICKET_LABEL','Ouaga Ofice','OUA','misspelling in source'),
  ('SDP_TICKET_LABEL','Ouaga Office (EDV ONE)','OUA',NULL),
  ('SDP_TICKET_LABEL','EDV One Building','OUA',NULL),
  ('SDP_TICKET_LABEL','EDV 1','OUA',NULL),
  ('SDP_TICKET_LABEL','EDV BUREAU OUAGA','OUA',NULL),
  ('SDP_TICKET_LABEL','Ouagadougou Exploration Office','OUA',NULL),

  ('SDP_TICKET_LABEL','KALANA','KGO',NULL),
  ('SDP_TICKET_LABEL','KALANA MINE','KGO',NULL),

  ('SDP_TICKET_LABEL','Dakar','DKR',NULL),
  ('SDP_TICKET_LABEL','Dakar Office','DKR',NULL),
  ('SDP_TICKET_LABEL','Senegal','DKR',NULL),

  ('SDP_TICKET_LABEL','ASSAFO','ASSAFO',NULL),
  ('SDP_TICKET_LABEL','ASAFO','ASSAFO','misspelling in source'),
  ('SDP_TICKET_LABEL','Assafo-Dibibango','ASSAFO',NULL),

  ('SDP_TICKET_LABEL','Tanda','TND',NULL),
  ('SDP_TICKET_LABEL','TANDA Office','TND',NULL),
  ('SDP_TICKET_LABEL','Tanda Regional Office','TND',NULL),
  ('SDP_TICKET_LABEL','Tanda Exploration Office','TND',NULL),

  ('SDP_TICKET_LABEL','EXPLORATION','EXPLO',NULL),
  ('SDP_TICKET_LABEL','Exploration CI','EXPLO',NULL),
  ('SDP_TICKET_LABEL','Endeavour Exploration','EXPLO',NULL),
  ('SDP_TICKET_LABEL','Eploration','EXPLO','misspelling in source'),
  ('SDP_TICKET_LABEL','EDV Explo','EXPLO',NULL),
  ('SDP_TICKET_LABEL','Fetekro','EXPLO',NULL),
  ('SDP_TICKET_LABEL','Fetekro Exploration Office','EXPLO',NULL),
  ('SDP_TICKET_LABEL','Fetekro Explorarion Office','EXPLO','misspelling in source'),
  ('SDP_TICKET_LABEL','Bonieredougou Exploration Office','EXPLO',NULL),
  ('SDP_TICKET_LABEL','Toulepleu','EXPLO',NULL),
  ('SDP_TICKET_LABEL','Binhouyé','EXPLO',NULL),
  ('SDP_TICKET_LABEL','Mahapleu','EXPLO',NULL),
  ('SDP_TICKET_LABEL','Floleu','EXPLO',NULL),
  ('SDP_TICKET_LABEL','Tiepleu','EXPLO',NULL),
  ('SDP_TICKET_LABEL','LAODY','EXPLO',NULL),
  ('SDP_TICKET_LABEL','SCD','EXPLO',NULL),

  -- department names, not sites: mapped to a visible UNMAPPED bucket
  ('SDP_TICKET_LABEL','All','UNMAPPED','department/global, not a site'),
  ('SDP_TICKET_LABEL','ADMIN','UNMAPPED','department, not a site'),
  ('SDP_TICKET_LABEL','IT','UNMAPPED','department, not a site'),
  ('SDP_TICKET_LABEL','HR','UNMAPPED','department, not a site'),
  ('SDP_TICKET_LABEL','CLINIC','UNMAPPED','department, not a site'),
  ('SDP_TICKET_LABEL','PROCCESS','UNMAPPED','department, not a site'),
  ('SDP_TICKET_LABEL','Process Plant','UNMAPPED','department, not a site'),
  ('SDP_TICKET_LABEL','Supply','UNMAPPED','department, not a site'),
  ('SDP_TICKET_LABEL','CSR','UNMAPPED','department, not a site'),
  ('SDP_TICKET_LABEL','QHSE','UNMAPPED','department, not a site'),
  ('SDP_TICKET_LABEL','Environment','UNMAPPED','department, not a site'),
  ('SDP_TICKET_LABEL','Technical Services','UNMAPPED','department, not a site'),
  ('SDP_TICKET_LABEL','AVIATION','UNMAPPED','department, not a site'),
  ('SDP_TICKET_LABEL','MSA','UNMAPPED','department, not a site'),
  ('SDP_TICKET_LABEL','EMSL','UNMAPPED','department, not a site')
ON CONFLICT (system, alias) DO NOTHING;

-- BAMAKO / CONAKRY / Burkina Faso / BF are deliberately NOT seeded: they are
-- countries or cities with no confirmed site, and must go through the review
-- queue rather than being guessed.
