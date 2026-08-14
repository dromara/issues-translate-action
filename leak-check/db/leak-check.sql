PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE leaks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  description TEXT,
  detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  severity TEXT,
  metadata TEXT
);
INSERT INTO leaks VALUES(1,'金慧妮','initial leak record inserted by script','2026-08-14 15:26:17','low','{}');
PRAGMA writable_schema=ON;
CREATE TABLE IF NOT EXISTS sqlite_sequence(name,seq);
DELETE FROM sqlite_sequence;
INSERT INTO sqlite_sequence VALUES('leaks',1);
CREATE INDEX idx_leaks_source ON leaks(source);
PRAGMA writable_schema=OFF;
COMMIT;
