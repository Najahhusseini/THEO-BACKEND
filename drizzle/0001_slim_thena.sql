ALTER TABLE "rooms" ADD COLUMN "out_of_order" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "out_of_order_reason" text;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "out_of_order_since" timestamp;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "out_of_order_set_by" uuid;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_out_of_order_set_by_staff_id_fk" FOREIGN KEY ("out_of_order_set_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;