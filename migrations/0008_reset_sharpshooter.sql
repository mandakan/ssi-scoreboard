-- Reset sharpshooter achievements after adding 10-match minimum rule.
-- Tiers will be re-evaluated on next dashboard load.
DELETE FROM shooter_achievements WHERE achievement_id = 'sharpshooter';
