#!/usr/bin/env bash
# Single-node MongoDB replica set for the A-prime.4 integration suite.
#
#   scripts/test-replica-set.sh start    # start, initiate, print the URI
#   scripts/test-replica-set.sh status
#   scripts/test-replica-set.sh stop
#
# mongod resolution order: $MONGOD_BIN, then `mongod` on PATH, then a pinned
# download from fastdl.mongodb.org into .cache/mongodb/<version>/ (gitignored).
# Linux x86_64 only; on macOS use an installed mongod via $MONGOD_BIN.
set -euo pipefail

PORT="${MONGO_TEST_PORT:-27018}"
RS="${MONGO_TEST_RS:-rs0}"
VERSION="${MONGO_TEST_VERSION:-8.0.4}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE="$ROOT/.cache/mongo-test"
DATA="$CACHE/data"
LOG="$CACHE/mongod.log"
PIDFILE="$CACHE/mongod.pid"
URI="mongodb://127.0.0.1:${PORT}/atai_integration?replicaSet=${RS}"
cd "$ROOT"

resolve_mongod() {
  if [[ -n "${MONGOD_BIN:-}" ]]; then echo "$MONGOD_BIN"; return; fi
  if command -v mongod >/dev/null 2>&1; then command -v mongod; return; fi
  local dir="$ROOT/.cache/mongodb/$VERSION"
  if [[ ! -x "$dir/bin/mongod" ]]; then
    if [[ "$(uname -s)" != "Linux" || "$(uname -m)" != "x86_64" ]]; then
      echo "No mongod found and no pinned download for $(uname -s)/$(uname -m). Set MONGOD_BIN." >&2
      exit 1
    fi
    echo "Downloading MongoDB $VERSION (once)..." >&2
    mkdir -p "$dir"
    curl -fsSL "https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-debian12-${VERSION}.tgz" \
      | tar -xz -C "$dir" --strip-components=1
  fi
  echo "$dir/bin/mongod"
}

initiate() {
  node -e "
const { MongoClient } = require('mongodb');
(async () => {
  const c = new MongoClient('mongodb://127.0.0.1:${PORT}/?directConnection=true', { serverSelectionTimeoutMS: 15000 });
  await c.connect();
  try {
    await c.db('admin').command({ replSetInitiate: { _id: '${RS}', members: [{ _id: 0, host: '127.0.0.1:${PORT}' }] } });
  } catch (e) { if (!/already initialized/i.test(e.message)) throw e; }
  for (let i = 0; i < 60; i++) {
    const h = await c.db('admin').command({ hello: 1 });
    if (h.isWritablePrimary) { await c.close(); return; }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('replica set did not elect a primary');
})().catch((e) => { console.error(e.message); process.exit(1); });
"
}

case "${1:-start}" in
  start)
    mkdir -p "$DATA"
    if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "already running (pid $(cat "$PIDFILE"))"
    else
      "$(resolve_mongod)" --replSet "$RS" --port "$PORT" --bind_ip 127.0.0.1 \
        --dbpath "$DATA" --logpath "$LOG" --pidfilepath "$PIDFILE" --fork >/dev/null
      echo "started mongod on port $PORT"
    fi
    initiate
    echo "MONGODB_REPLICA_URI='$URI'"
    ;;
  status)
    if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "running (pid $(cat "$PIDFILE"))"; echo "MONGODB_REPLICA_URI='$URI'"
    else
      echo "not running"; exit 1
    fi
    ;;
  stop)
    if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      kill "$(cat "$PIDFILE")" && echo "stopped"
    else
      echo "not running"
    fi
    ;;
  *)
    echo "usage: $0 start|status|stop" >&2; exit 2 ;;
esac
