-- leak-check database schema (example)

CREATE TABLE IF NOT EXISTS leaks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  description TEXT,
  detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  severity TEXT,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_leaks_source ON leaks(source);
