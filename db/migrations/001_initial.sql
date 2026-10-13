CREATE TABLE members (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL UNIQUE CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 254),
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100),
  role TEXT NOT NULL CHECK (role IN ('ADVERTISER', 'ADMIN')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  member_id BIGINT NOT NULL REFERENCES members(id),
  csrf_token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at > created_at)
);
CREATE INDEX sessions_member_expiry_idx ON sessions(member_id, expires_at);

CREATE TABLE campaigns (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES members(id),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  status TEXT NOT NULL DEFAULT 'PAUSED' CHECK (status IN ('ACTIVE', 'PAUSED')),
  total_budget BIGINT NOT NULL CHECK (total_budget BETWEEN 1 AND 1000000000),
  spent_amount BIGINT NOT NULL DEFAULT 0 CHECK (spent_amount BETWEEN 0 AND total_budget),
  last_execution_no BIGINT NOT NULL DEFAULT 0 CHECK (last_execution_no >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX campaigns_owner_created_idx ON campaigns(owner_id, created_at DESC, id DESC);

CREATE TABLE executions (
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id),
  execution_no BIGINT NOT NULL CHECK (execution_no > 0),
  status TEXT NOT NULL DEFAULT 'PREPARED' CHECK (status IN ('PREPARED', 'APPROVED', 'REJECTED')),
  requested_amount BIGINT,
  approved_amount BIGINT NOT NULL DEFAULT 0,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  processed_at TIMESTAMPTZ,
  PRIMARY KEY(campaign_id, execution_no),
  CONSTRAINT execution_result_consistent CHECK (
    (status = 'PREPARED' AND requested_amount IS NULL AND approved_amount = 0 AND rejection_reason IS NULL AND processed_at IS NULL)
    OR
    (status = 'APPROVED' AND requested_amount IS NOT NULL AND requested_amount BETWEEN 1 AND 1000000000
      AND approved_amount = requested_amount AND rejection_reason IS NULL AND processed_at IS NOT NULL)
    OR
    (status = 'REJECTED' AND requested_amount IS NOT NULL AND requested_amount BETWEEN 1 AND 1000000000
      AND approved_amount = 0 AND rejection_reason IS NOT NULL
      AND rejection_reason IN ('CAMPAIGN_PAUSED', 'INSUFFICIENT_BUDGET') AND processed_at IS NOT NULL)
  )
);
CREATE INDEX executions_processed_idx ON executions(campaign_id, processed_at DESC, execution_no DESC);
