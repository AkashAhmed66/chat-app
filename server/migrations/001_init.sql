-- Users -------------------------------------------------------------
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      varchar(30)  NOT NULL,
  display_name  varchar(60)  NOT NULL,
  email         varchar(255) NOT NULL,
  password_hash text         NOT NULL,
  last_seen_at  timestamptz,
  created_at    timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username_uq ON users (lower(username));
CREATE UNIQUE INDEX users_email_uq    ON users (lower(email));

-- Friend requests / friendships --------------------------------------
CREATE TABLE friendships (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (requester_id <> addressee_id)
);
-- one row per unordered pair of users
CREATE UNIQUE INDEX friendships_pair_uq
  ON friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));
CREATE INDEX friendships_addressee_idx ON friendships (addressee_id, status);
CREATE INDEX friendships_requester_idx ON friendships (requester_id, status);

-- Direct messages ------------------------------------------------------
CREATE TABLE messages (
  id           bigserial PRIMARY KEY,
  sender_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body         text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at   timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  read_at      timestamptz
);
CREATE INDEX messages_pair_idx
  ON messages (LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id), id DESC);
CREATE INDEX messages_unread_idx ON messages (receiver_id, sender_id) WHERE read_at IS NULL;
CREATE INDEX messages_undelivered_idx ON messages (receiver_id) WHERE delivered_at IS NULL;

-- Persistent notifications (friend requests, accepted, missed calls) ----
CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       text NOT NULL,
  actor_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

-- Call log ---------------------------------------------------------------
CREATE TABLE calls (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  callee_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN ('audio', 'video')),
  status      text NOT NULL DEFAULT 'ringing'
              CHECK (status IN ('ringing', 'accepted', 'rejected', 'missed', 'cancelled', 'ended')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  ended_at    timestamptz
);
CREATE INDEX calls_active_idx ON calls (caller_id, callee_id) WHERE status IN ('ringing', 'accepted');
