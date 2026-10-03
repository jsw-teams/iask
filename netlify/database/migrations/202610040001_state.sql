CREATE TABLE IF NOT EXISTS commentnest_state (
  namespace text NOT NULL,
  key text NOT NULL,
  value jsonb NOT NULL,
  PRIMARY KEY (namespace, key)
);
