#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-mktmood}"
APP_DIR="${APP_DIR:-/Users/zyzbot/MyProject/MktMood}"
PORT="${PORT:-3000}"
LOCAL_URL="http://127.0.0.1:${PORT}"

cd "$APP_DIR"

echo "==> Pull latest code"
git pull --ff-only

echo "==> Install dependencies"
npm install

echo "==> Syntax check"
node --check server.js
node --check db.js
node --check public/app.js
if [ -f playbooks.js ]; then
  node --check playbooks.js
fi

echo "==> Check external binding config"
if [ -f .env ] && ! grep -q '^HOST=0\.0\.0\.0$' .env; then
  echo "WARNING: .env does not contain HOST=0.0.0.0; external access may be limited."
fi

echo "==> Stop PM2 app if exists"
pm2 delete "$APP_NAME" || true

echo "==> Check port $PORT"
PID_ON_PORT="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN || true)"
if [ -n "$PID_ON_PORT" ]; then
  echo "Port $PORT is still occupied by PID(s):"
  echo "$PID_ON_PORT"
  echo "Stopping stale process(es)"
  kill $PID_ON_PORT || true
  sleep 2
fi

PID_ON_PORT="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN || true)"
if [ -n "$PID_ON_PORT" ]; then
  echo "Port $PORT is still occupied; force killing PID(s):"
  echo "$PID_ON_PORT"
  kill -9 $PID_ON_PORT
fi

echo "==> Start app with PM2"
pm2 start server.js --name "$APP_NAME" --cwd "$APP_DIR" --update-env
pm2 save

echo "==> Wait for service"
sleep 5

echo "==> Verify port owner"
PM2_PID="$(pm2 pid "$APP_NAME")"
PORT_PID="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN || true)"
echo "PM2 PID: $PM2_PID"
echo "PORT PID: $PORT_PID"

if ! printf '%s\n' "$PORT_PID" | grep -qx "$PM2_PID"; then
  echo "ERROR: Port $PORT is not owned by PM2 process $APP_NAME"
  exit 1
fi

echo "==> Verify frontend bundle"
curl -fsS --max-time 10 "$LOCAL_URL/app.js" | grep -q "renderMacroInterpretation" \
  && echo "Frontend check passed" \
  || echo "WARNING: Frontend marker not found"

echo "==> Verify health API"
curl -fsS --max-time 10 "$LOCAL_URL/api/health"
echo

echo "==> Verify macro playbook API marker"
if curl -fsS --max-time 60 "$LOCAL_URL/api/events" | grep -q "higherThanExpected"; then
  echo "Macro playbook API check passed"
else
  echo "WARNING: Macro playbook API marker not found"
fi

echo "==> Verify anomaly profile marker"
if curl -fsS --max-time 60 "$LOCAL_URL/api/anomalies" | grep -q "companyBrief"; then
  echo "Anomaly profile API check passed"
else
  echo "WARNING: Anomaly profile marker not found"
fi

echo "==> Verify Hermes monitor marker"
if curl -fsS --max-time 60 "$LOCAL_URL/api/hermes/monitor?minSeverity=high&limit=1" | grep -q '"service":"MktMood"'; then
  echo "Hermes monitor check passed"
else
  echo "WARNING: Hermes monitor marker not found"
fi

echo "==> Done"
pm2 status "$APP_NAME"
