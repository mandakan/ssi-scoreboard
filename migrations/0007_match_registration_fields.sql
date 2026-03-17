-- Registration & squadding metadata on the matches domain table.
-- Each ALTER is a separate statement so failures (column already exists) are independent.
ALTER TABLE matches ADD COLUMN registration_starts TEXT;
ALTER TABLE matches ADD COLUMN registration_closes TEXT;
ALTER TABLE matches ADD COLUMN registration_status TEXT;
ALTER TABLE matches ADD COLUMN squadding_starts TEXT;
ALTER TABLE matches ADD COLUMN squadding_closes TEXT;
ALTER TABLE matches ADD COLUMN is_registration_possible INTEGER DEFAULT 0;
ALTER TABLE matches ADD COLUMN is_squadding_possible INTEGER DEFAULT 0;
ALTER TABLE matches ADD COLUMN max_competitors INTEGER;
