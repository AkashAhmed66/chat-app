-- Migration 002: Add rich media, profile management, call durations, and chat locks

-- 1. Users: avatar and bio
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio varchar(250) DEFAULT '';

-- 2. Messages: rich media types and metadata
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_body_check;
ALTER TABLE messages ADD CONSTRAINT messages_body_check CHECK (char_length(body) <= 4000);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'text';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_url text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_name text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_size bigint;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_mime text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS duration int DEFAULT 0;

-- 3. Calls: call duration in seconds
ALTER TABLE calls ADD COLUMN IF NOT EXISTS duration int DEFAULT 0;
CREATE INDEX IF NOT EXISTS calls_user_idx ON calls (caller_id, callee_id, created_at DESC);

-- 4. Chat locks for password-protected conversations
CREATE TABLE IF NOT EXISTS chat_locks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user1_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user2_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'none' CHECK (status IN ('none', 'requested', 'active')),
  requester_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  pending_hash  text,
  password_hash text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (user1_id <> user2_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS chat_locks_pair_uq
  ON chat_locks (LEAST(user1_id, user2_id), GREATEST(user1_id, user2_id));
CREATE INDEX IF NOT EXISTS chat_locks_status_idx ON chat_locks (status);
