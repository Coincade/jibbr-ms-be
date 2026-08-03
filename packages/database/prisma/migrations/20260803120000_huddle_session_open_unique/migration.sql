-- Prevent duplicate open huddle sessions for the same room (concurrent first-join race).
-- Keep the newest open row when duplicates already exist.
DELETE FROM "HuddleSession" AS a
USING "HuddleSession" AS b
WHERE a."roomId" = b."roomId"
  AND a."endedAt" IS NULL
  AND b."endedAt" IS NULL
  AND a."id" <> b."id"
  AND a."startedAt" < b."startedAt";

CREATE UNIQUE INDEX IF NOT EXISTS "HuddleSession_roomId_open_uidx"
ON "HuddleSession" ("roomId")
WHERE "endedAt" IS NULL;
