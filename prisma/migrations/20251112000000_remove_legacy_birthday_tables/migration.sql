-- Remove legacy birthday-specific tables in favor of event-generic system
-- This migration consolidates to RecurringEvent + ScheduledNotification architecture

-- Drop indexes first
DROP INDEX IF EXISTS "idx_delivery_attempts_message";
DROP INDEX IF EXISTS "idx_birthday_messages_pending_scheduled";

-- Drop legacy tables
DROP TABLE IF EXISTS "delivery_attempts" CASCADE;
DROP TABLE IF EXISTS "birthday_messages" CASCADE;

-- Drop legacy enum
DROP TYPE IF EXISTS "attempt_status";

-- Note: RecurringEvent and ScheduledNotification tables remain
-- These are the event-generic replacements for the legacy system
