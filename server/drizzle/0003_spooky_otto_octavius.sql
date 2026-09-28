ALTER TABLE "document" ALTER COLUMN "created_at" SET DATA TYPE timestamp (3) with time zone USING date_trunc('milliseconds', "created_at");--> statement-breakpoint
ALTER TABLE "document" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "document" ALTER COLUMN "updated_at" SET DATA TYPE timestamp (3) with time zone USING date_trunc('milliseconds', "updated_at");--> statement-breakpoint
ALTER TABLE "document" ALTER COLUMN "updated_at" SET DEFAULT now();