-- Add video_owner_page_id column to ads table
-- Stores the actual owner page of the video (from Meta's "from" field)
-- which may differ from creative.actor_id (the page running the ad).
-- Populated lazily on first video playback.

ALTER TABLE ads ADD COLUMN IF NOT EXISTS video_owner_page_id TEXT;
