CREATE TABLE pilots (
  code TEXT PRIMARY KEY,
  agency TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE reports (
  install_id TEXT NOT NULL,
  code TEXT NOT NULL,
  day TEXT NOT NULL,
  version TEXT NOT NULL,
  payload TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (install_id, day)
);
CREATE INDEX reports_received ON reports (received_at);

CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  install_id TEXT NOT NULL,
  code TEXT NOT NULL,
  version TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE INDEX feedback_code_received ON feedback (code, received_at);
