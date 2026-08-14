leak-check

This folder contains database schema and instructions to initialize a local SQLite database used for leak-check tasks.

To create the database locally, run:

```bash
mkdir -p leak-check/db
sqlite3 leak-check/db/leak-check.db < leak-check/db/schema.sql
```

If sqlite3 is not installed, install it on your platform (e.g., apt, brew, choco) or use a local Docker container:

```bash
docker run --rm -v "$(pwd)":/work -w /work nouchka/sqlite3 sqlite3 leak-check/db/leak-check.db ".read leak-check/db/schema.sql"
```

Schema is in db/schema.sql. Modify as needed for your leak tracking requirements.
