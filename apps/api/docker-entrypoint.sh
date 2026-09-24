#!/bin/sh
set -e

# Runs on every container start, not just the first: ensureAppRole and the
# migrator (src/db/migrate.ts) are both idempotent, so this is safe to
# repeat. Deliberately synchronous and blocking — the app must not start
# accepting requests against a schema that isn't there yet or is mid-migration.
echo "Running database migrations..."
node dist/db/migrate.js

# Hands off to the CMD (`node dist/index.js`) via exec, not a child process,
# so it becomes PID 1 and receives Docker's stop signals directly instead of
# them being swallowed by this script.
exec "$@"
