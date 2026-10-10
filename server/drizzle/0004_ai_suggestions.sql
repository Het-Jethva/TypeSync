ALTER TABLE "document" ADD COLUMN "ai_suggestions" jsonb NOT NULL DEFAULT '[]'::jsonb;
