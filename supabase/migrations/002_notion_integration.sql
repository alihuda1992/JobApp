-- Add Notion integration fields to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notion_token text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notion_db_id text;
