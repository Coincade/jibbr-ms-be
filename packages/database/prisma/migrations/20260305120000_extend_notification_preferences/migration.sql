-- Extend UserNotificationPreference with level, extra rules, schedule, mute, sounds
ALTER TABLE "UserNotificationPreference" ADD COLUMN IF NOT EXISTS "level" VARCHAR(32) NOT NULL DEFAULT 'everything';
ALTER TABLE "UserNotificationPreference" ADD COLUMN IF NOT EXISTS "tangentReplies" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "UserNotificationPreference" ADD COLUMN IF NOT EXISTS "starredMessagesEvenIfPaused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "UserNotificationPreference" ADD COLUMN IF NOT EXISTS "newHuddles" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "UserNotificationPreference" ADD COLUMN IF NOT EXISTS "scheduleEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "UserNotificationPreference" ADD COLUMN IF NOT EXISTS "scheduleMode" VARCHAR(32) NOT NULL DEFAULT 'weekdays';
ALTER TABLE "UserNotificationPreference" ADD COLUMN IF NOT EXISTS "scheduleDays" INTEGER[] NOT NULL DEFAULT ARRAY[1, 2, 3, 4, 5];
ALTER TABLE "UserNotificationPreference" ADD COLUMN IF NOT EXISTS "scheduleStart" VARCHAR(8) NOT NULL DEFAULT '09:00';
ALTER TABLE "UserNotificationPreference" ADD COLUMN IF NOT EXISTS "scheduleEnd" VARCHAR(8) NOT NULL DEFAULT '18:00';
ALTER TABLE "UserNotificationPreference" ADD COLUMN IF NOT EXISTS "muteAll" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "UserNotificationPreference" ADD COLUMN IF NOT EXISTS "soundMessage" VARCHAR(64) NOT NULL DEFAULT 'boop';
ALTER TABLE "UserNotificationPreference" ADD COLUMN IF NOT EXISTS "soundStarred" VARCHAR(64) NOT NULL DEFAULT 'boop';
ALTER TABLE "UserNotificationPreference" ADD COLUMN IF NOT EXISTS "soundHuddle" VARCHAR(64) NOT NULL DEFAULT 'boop';
ALTER TABLE "UserNotificationPreference" ADD COLUMN IF NOT EXISTS "muteHuddleSounds" BOOLEAN NOT NULL DEFAULT false;
