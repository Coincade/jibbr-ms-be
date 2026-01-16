# Database Indexes Implementation Guide

## Overview
This guide explains how to add database indexes to improve query performance for message retrieval and other frequently accessed data.

## Why Indexes Matter

**Without indexes:**
- Database scans entire table (slow for large datasets)
- Message queries: 100-500ms+ for channels with many messages

**With indexes:**
- Database uses index to find data quickly
- Message queries: 10-50ms (10x faster!)

## Indexes to Add

Based on your query patterns, here are the critical indexes:

### 1. Message Model Indexes

**Most Important:**
- `(channelId, createdAt DESC)` - For fetching channel messages
- `(conversationId, createdAt DESC)` - For fetching DM messages
- `(userId, createdAt DESC)` - For user's message history
- `(deletedAt)` - For filtering out deleted messages

### 2. ChannelMember Model Indexes

- `(userId, channelId, isActive)` - For checking channel membership
- `(channelId, isActive)` - For listing channel members

### 3. ConversationParticipant Indexes

- `(userId, isActive)` - For listing user's conversations
- `(conversationId, isActive)` - For checking participation

## Implementation Methods

### Method 1: Using Prisma Migrations (Recommended)

This is the **safest and recommended** approach:

#### Step 1: Update Prisma Schema

Edit `packages/database/prisma/schema.prisma`:

```prisma
model Message {
  id                String             @id @default(cuid())
  content           String
  createdAt         DateTime           @default(now())
  updatedAt         DateTime           @default(now()) @updatedAt
  channelId         String?
  replyToId         String?
  userId            String
  conversationId    String?
  deletedAt         DateTime?
  attachments       Attachment[]
  forwardedMessages ForwardedMessage[]
  channel           Channel?           @relation(fields: [channelId], references: [id])
  conversation      Conversation?      @relation(fields: [conversationId], references: [id])
  replyTo           Message?           @relation("MessageReplies", fields: [replyToId], references: [id])
  replies           Message[]          @relation("MessageReplies")
  user              User               @relation(fields: [userId], references: [id])
  mentions          MessageMention[]
  reactions         Reaction[]

  // Performance indexes for fast message queries
  @@index([channelId, createdAt(sort: Desc)])
  @@index([conversationId, createdAt(sort: Desc)])
  @@index([userId, createdAt(sort: Desc)])
  @@index([deletedAt])
}

model ChannelMember {
  id          String    @id @default(cuid())
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @default(now()) @updatedAt
  channelId   String
  userId      String
  isActive    Boolean   @default(true)
  lastReadAt  DateTime?
  unreadCount Int       @default(0)
  channel     Channel   @relation(fields: [channelId], references: [id])
  user        User      @relation(fields: [userId], references: [id])

  @@unique([channelId, userId])
  // Performance indexes for membership checks
  @@index([userId, channelId, isActive])
  @@index([channelId, isActive])
}

model ConversationParticipant {
  id             String       @id @default(cuid())
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @default(now()) @updatedAt
  conversationId String
  userId         String
  isActive       Boolean      @default(true)
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([conversationId, userId])
  // Performance indexes for conversation queries
  @@index([userId, isActive])
  @@index([conversationId, isActive])
}
```

#### Step 2: Create Migration

```powershell
cd d:\Projects\jibbr-turbo-repo\packages\database
npm run db:migrate -- --name add_performance_indexes
```

This will:
1. Generate a migration file in `prisma/migrations/`
2. Create the indexes in your database
3. Update the Prisma client

#### Step 3: Apply Migration

The migration will be applied automatically, or you can run:

```powershell
npm run db:migrate
```

### Method 2: Direct SQL (Alternative)

If you prefer to add indexes directly via SQL:

#### Step 1: Connect to Database

```powershell
# Using psql (if installed)
psql -h localhost -U postgres -d jibbr-messaging

# Or use Prisma Studio
cd packages/database
npm run db:studio
```

#### Step 2: Run SQL Commands

```sql
-- Message indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_message_channel_created 
  ON "Message"(channelId, createdAt DESC) 
  WHERE deletedAt IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_message_conversation_created 
  ON "Message"(conversationId, createdAt DESC) 
  WHERE deletedAt IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_message_user_created 
  ON "Message"(userId, createdAt DESC) 
  WHERE deletedAt IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_message_deleted_at 
  ON "Message"(deletedAt) 
  WHERE deletedAt IS NOT NULL;

-- ChannelMember indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_channel_member_user_channel_active 
  ON "ChannelMember"(userId, channelId, isActive) 
  WHERE isActive = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_channel_member_channel_active 
  ON "ChannelMember"(channelId, isActive) 
  WHERE isActive = true;

-- ConversationParticipant indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversation_participant_user_active 
  ON "ConversationParticipant"(userId, isActive) 
  WHERE isActive = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversation_participant_conversation_active 
  ON "ConversationParticipant"(conversationId, isActive) 
  WHERE isActive = true;
```

**Note:** `CONCURRENTLY` allows creating indexes without locking the table (important for production).

### Method 3: Prisma Migration with Custom SQL

If you want more control, create a migration manually:

#### Step 1: Create Migration File

```powershell
cd d:\Projects\jibbr-turbo-repo\packages\database
npx prisma migrate dev --create-only --name add_performance_indexes
```

This creates a migration file without applying it.

#### Step 2: Edit Migration File

Edit the generated file in `prisma/migrations/YYYYMMDDHHMMSS_add_performance_indexes/migration.sql`:

```sql
-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_message_channel_created" 
  ON "Message"("channelId", "createdAt" DESC) 
  WHERE "deletedAt" IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_message_conversation_created" 
  ON "Message"("conversationId", "createdAt" DESC) 
  WHERE "deletedAt" IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_message_user_created" 
  ON "Message"("userId", "createdAt" DESC) 
  WHERE "deletedAt" IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_message_deleted_at" 
  ON "Message"("deletedAt") 
  WHERE "deletedAt" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_channel_member_user_channel_active" 
  ON "ChannelMember"("userId", "channelId", "isActive") 
  WHERE "isActive" = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_channel_member_channel_active" 
  ON "ChannelMember"("channelId", "isActive") 
  WHERE "isActive" = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_conversation_participant_user_active" 
  ON "ConversationParticipant"("userId", "isActive") 
  WHERE "isActive" = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_conversation_participant_conversation_active" 
  ON "ConversationParticipant"("conversationId", "isActive") 
  WHERE "isActive" = true;
```

#### Step 3: Apply Migration

```powershell
npm run db:migrate
```

## Partial Indexes (WHERE Clauses)

**Why use partial indexes?**
- Smaller index size (only indexes relevant rows)
- Faster queries (less data to scan)
- Better performance

**Examples:**
- `WHERE deletedAt IS NULL` - Only index non-deleted messages
- `WHERE isActive = true` - Only index active members

## Performance Impact

### Before Indexes:
```
Query: Get messages for channel
- Table scan: 1000ms for 100K messages
- Membership check: 50ms per check
```

### After Indexes:
```
Query: Get messages for channel
- Index lookup: 10-50ms (20x faster!)
- Membership check: 1-5ms (10x faster!)
```

## Verification

### Check if Indexes Exist:

```sql
-- List all indexes on Message table
SELECT 
  indexname, 
  indexdef 
FROM pg_indexes 
WHERE tablename = 'Message';

-- Check index usage
SELECT 
  schemaname,
  tablename,
  indexname,
  idx_scan as index_scans,
  idx_tup_read as tuples_read,
  idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE tablename = 'Message'
ORDER BY idx_scan DESC;
```

### Test Query Performance:

```sql
-- Test channel message query (should use index)
EXPLAIN ANALYZE
SELECT * FROM "Message"
WHERE "channelId" = 'some-channel-id'
  AND "deletedAt" IS NULL
ORDER BY "createdAt" DESC
LIMIT 50;
```

Look for `Index Scan` in the output (good!) vs `Seq Scan` (bad, means no index used).

## Best Practices

1. **Add indexes gradually** - Don't add all at once in production
2. **Monitor index usage** - Remove unused indexes
3. **Use partial indexes** - When you filter by specific conditions
4. **Test on staging first** - Verify performance improvements
5. **Monitor disk space** - Indexes take up space

## Rollback Plan

If you need to remove indexes:

```sql
DROP INDEX CONCURRENTLY IF EXISTS idx_message_channel_created;
DROP INDEX CONCURRENTLY IF EXISTS idx_message_conversation_created;
-- ... etc
```

Or create a rollback migration:

```powershell
npx prisma migrate dev --create-only --name remove_performance_indexes
```

## Recommended Approach

**For your project, I recommend Method 1 (Prisma Schema + Migration):**

1. ✅ Type-safe (Prisma validates)
2. ✅ Version controlled (migration files)
3. ✅ Reversible (can rollback)
4. ✅ Team-friendly (everyone gets same indexes)

## Next Steps

1. Update `schema.prisma` with indexes (see Method 1)
2. Create migration: `npm run db:migrate -- --name add_performance_indexes`
3. Test query performance
4. Monitor index usage in production

## Expected Performance Improvement

| Query Type | Before | After | Improvement |
|------------|--------|-------|-------------|
| Get channel messages | 200-500ms | 10-50ms | **10-20x faster** |
| Check channel membership | 20-50ms | 1-5ms | **10x faster** |
| Get user conversations | 100-300ms | 10-30ms | **10x faster** |
| Filter deleted messages | 50-100ms | 5-10ms | **10x faster** |

These indexes will significantly improve your message delivery speed, especially as your database grows!
