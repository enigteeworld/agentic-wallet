#!/usr/bin/env bash
set -e

DATA_ROOT="/var/data/corsair"

mkdir -p "$DATA_ROOT/keystore"
mkdir -p "$DATA_ROOT/state"
mkdir -p "$DATA_ROOT/logs"
mkdir -p "$DATA_ROOT/public/telemetry"

# If you want to provide the keystore via env var:
if [ -n "$KEYSTORE_JSON" ] && [ ! -f "$DATA_ROOT/keystore/agent-001.json" ]; then
  printf "%s" "$KEYSTORE_JSON" > "$DATA_ROOT/keystore/agent-001.json"
fi

# Replace local folders with symlinks to the persistent disk
rm -rf keystore state logs public/telemetry || true

ln -sfn "$DATA_ROOT/keystore" keystore
ln -sfn "$DATA_ROOT/state" state
ln -sfn "$DATA_ROOT/logs" logs

mkdir -p public
ln -sfn "$DATA_ROOT/public/telemetry" public/telemetry

npm run dev -- agent:run --agent "${AGENT_ID:-agent-001}"