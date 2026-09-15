#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# DEPLOY REHEARSAL: run the app on this Mac the way the Lightsail container will
#
# Run from the repo root:   sh backend/scripts/rehearse-deploy.sh
#
# No Docker needed. Builds the frontend, then starts the server with the
# container's own settings (production mode, port 8080, an EMPTY data folder so
# it must seed itself) and only the settings Lightsail will have: the gateway
# key and demo PIN load from backend/.env, and everything Lightsail will NOT
# have (the local llama3 model, a default tier override, the Anthropic key) is
# blanked. Then runs check-deploy.js against it and stops the server.
#
# Spends no credit. Expect two results that are fine on a Mac: a WARN for plain
# http, and a FAIL for the published image until it is made public on GitHub
# (step 1 of the deploy checklist). Everything else must PASS.
# ─────────────────────────────────────────────────────────────────────────────

cd "$(git rev-parse --show-toplevel)" || exit 1
if lsof -i :8080 -sTCP:LISTEN >/dev/null 2>&1; then echo "Port 8080 is in use. Stop whatever is on it first."; exit 1; fi

echo "Building the frontend..."
(cd frontend && npx vite build >/dev/null) || { echo "Frontend build failed."; exit 1; }

DATA=$(mktemp -d)
env NODE_ENV=production DATA_DIR="$DATA" PORT=8080 \
    OLLAMA_URL= OLLAMA_MODEL= LLM_DEFAULT_MODE= LLM_PROVIDER= ANTHROPIC_API_KEY= ANTHROPIC_MODEL= CORS_ORIGIN= \
    node backend/src/index.js > "$DATA/server.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; wait $SERVER 2>/dev/null; rm -rf "$DATA"' EXIT

i=0
until curl -s http://localhost:8080/api/health >/dev/null; do
  i=$((i + 1)); [ $i -gt 20 ] && { echo "Server did not start. Log:"; cat "$DATA/server.log"; exit 1; }
  sleep 1
done
grep -q "seeding demo data" "$DATA/server.log" && echo "Seeded itself on an empty data folder, as the container will."

node backend/scripts/check-deploy.js http://localhost:8080
