-- Add cabin_map column to yachts table for interactive deck plan
-- This stores the mapping of cabin numbers to their coordinates on the deck plan image

ALTER TABLE yachts ADD COLUMN IF NOT EXISTS cabin_map jsonb;

-- Add GIN index for faster JSONB queries
CREATE INDEX IF NOT EXISTS idx_yachts_cabin_map ON yachts USING GIN (cabin_map);

-- Add column comment
COMMENT ON COLUMN yachts.cabin_map IS 'Interactive deck plan: cabin coordinates mapped to image. Format: {"imageWidth": 1200, "imageHeight": 2000, "cabins": [{"cabin_number": 1, "left": 214, "top": 732, "right": 280, "bottom": 795}]}';
