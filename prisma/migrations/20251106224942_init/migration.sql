-- CreateEnum
CREATE TYPE "event_type" AS ENUM ('BIRTHDAY', 'ANNIVERSARY', 'SUBSCRIPTION_RENEWAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "message_status" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "attempt_status" AS ENUM ('SUCCESS', 'FAILED', 'TIMEOUT');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "first_name" VARCHAR(255) NOT NULL,
    "last_name" VARCHAR(255) NOT NULL,
    "birthday" DATE NOT NULL,
    "timezone" VARCHAR(50) NOT NULL,
    "birthday_month" SMALLINT NOT NULL,
    "birthday_day" SMALLINT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "event_type" NOT NULL,
    "event_date" DATE NOT NULL,
    "notification_time" VARCHAR(8) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "birthday_messages" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "status" "message_status" NOT NULL DEFAULT 'PENDING',
    "delivered_at" TIMESTAMP(3),
    "retry_count" SMALLINT NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "webhook_response_code" SMALLINT,
    "processing_duration_ms" INTEGER,
    "worker_instance_id" VARCHAR(100),
    "user_snapshot" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "birthday_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_notifications" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "status" "message_status" NOT NULL DEFAULT 'PENDING',
    "delivered_at" TIMESTAMP(3),
    "retry_count" SMALLINT NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "webhook_response_code" SMALLINT,
    "processing_duration_ms" INTEGER,
    "worker_instance_id" VARCHAR(100),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_attempts" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "attempt_number" SMALLINT NOT NULL,
    "status" "attempt_status" NOT NULL,
    "http_status_code" SMALLINT,
    "error_message" TEXT,
    "response_body" TEXT,
    "duration_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_users_birthday_lookup" ON "users"("birthday_month", "birthday_day", "timezone");

-- CreateIndex
CREATE INDEX "idx_users_active" ON "users"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_recurring_events_lookup" ON "recurring_events"("type", "event_date", "enabled");

-- CreateIndex
CREATE INDEX "idx_birthday_messages_pending_scheduled" ON "birthday_messages"("status", "scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "birthday_messages_user_id_scheduled_for_key" ON "birthday_messages"("user_id", "scheduled_for");

-- CreateIndex
CREATE INDEX "idx_notifications_pending_scheduled" ON "scheduled_notifications"("status", "scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_notifications_event_id_scheduled_for_key" ON "scheduled_notifications"("event_id", "scheduled_for");

-- CreateIndex
CREATE INDEX "idx_delivery_attempts_message" ON "delivery_attempts"("message_id", "attempt_number");

-- AddForeignKey
ALTER TABLE "recurring_events" ADD CONSTRAINT "recurring_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "birthday_messages" ADD CONSTRAINT "birthday_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_notifications" ADD CONSTRAINT "scheduled_notifications_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "recurring_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
