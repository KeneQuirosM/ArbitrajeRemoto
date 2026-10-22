#!/usr/bin/env bash
# ArbitrajeRemoto API v1 — curl examples, runnable end to end.
#
#   Local:      npm run dev:api            (in another terminal)
#               PASSPHRASE='tu frase' bash examples/curl.sh
#   Production: BASE=https://<tu-sitio>.netlify.app/api/v1 PASSPHRASE='tu frase' bash examples/curl.sh
#               (creates test data: "Halcones vs Toros" and a paired test device that is revoked at the end)
#
# Needs: bash, curl, jq. Each step checks the HTTP status and stops on the first surprise.

set -euo pipefail

BASE="${BASE:-http://localhost:8787/api/v1}"
PASSPHRASE="${PASSPHRASE:?Set PASSPHRASE to the owner passphrase}"
JAR="$(mktemp)"
OUT="$(mktemp)"
trap 'rm -f "$JAR" "$OUT"' EXIT

uuid() { node -e "console.log(require('node:crypto').randomUUID())"; }
now() { date -u +%Y-%m-%dT%H:%M:%S.000Z; }
ago() { date -u -d "-$1 minutes" +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || date -u -v-"$1"M +%Y-%m-%dT%H:%M:%S.000Z; }

# call EXPECTED_STATUS METHOD PATH [JSON_BODY] [extra curl args...]
call() {
  local expected="$1" method="$2" path="$3" body="${4:-}"
  shift 4 || shift $#
  local args=(-sS -o "$OUT" -w '%{http_code}' -X "$method" -b "$JAR" -c "$JAR" "$@")
  [[ -n "$body" ]] && args+=(-H 'Content-Type: application/json' --data "$body")
  local status
  : > "$OUT"   # a 304 has no body: do not show the previous response
  status="$(curl "${args[@]}" "$BASE$path")"
  printf '\n→ %s %s  [%s]\n' "$method" "$path" "$status"
  [[ -s "$OUT" ]] && jq -c . "$OUT" 2>/dev/null | cut -c1-400 || true
  if [[ "$status" != "$expected" ]]; then
    echo "✗ expected HTTP $expected" >&2
    exit 1
  fi
}

echo "== 0. Health (public)"
call 200 GET /health

echo "== 1. Owner login (sets the ar_session cookie)"
call 200 POST /session "{\"passphrase\": $(jq -Rn --arg p "$PASSPHRASE" '$p')}"
call 200 GET /session

echo "== 2. Teams with rosters (PUT is create-or-replace)"
HOME_ID="$(uuid)"; AWAY_ID="$(uuid)"
call 201 PUT "/teams/$HOME_ID" '{"name":"Halcones","players":[{"number":1,"name":"Portero"},{"number":9,"name":"Delantera"},{"number":10}]}'
call 201 PUT "/teams/$AWAY_ID" '{"name":"Toros","players":[{"number":1},{"number":4},{"number":11}]}'
call 200 GET /teams

echo "== 3. Create a match with a client-generated id (idempotent)"
MATCH_ID="$(uuid)"
MATCH="{\"id\":\"$MATCH_ID\",\"homeTeamId\":\"$HOME_ID\",\"awayTeamId\":\"$AWAY_ID\",\"scheduledAt\":\"$(now)\",\"tournament\":\"Liga de prueba\",\"deviceId\":\"web-curl\"}"
call 201 POST /matches "$MATCH"
LIVE_TOKEN="$(jq -r .match.liveToken "$OUT")"
call 200 POST /matches "$MATCH"   # same request again: 200 + "duplicate": true

echo "== 4. Light list for the watch"
call 200 GET '/matches?status=scheduled,live&fields=homeTeamName,awayTeamName,scheduledAt,status'

echo "== 5. Event batch (sent 3 times: same data every time)"
GOAL_ID="$(uuid)"
EVENTS="[
  {\"id\":\"$(uuid)\",\"type\":\"period_start\",\"period\":1,\"clientTimestamp\":\"$(ago 30)\"},
  {\"id\":\"$GOAL_ID\",\"type\":\"goal\",\"team\":\"home\",\"playerNumber\":9,\"clientTimestamp\":\"$(ago 20)\"},
  {\"id\":\"$(uuid)\",\"type\":\"yellow_card\",\"team\":\"away\",\"playerNumber\":4,\"clientTimestamp\":\"$(ago 15)\"},
  {\"id\":\"$(uuid)\",\"type\":\"substitution\",\"team\":\"away\",\"playerOutNumber\":4,\"playerInNumber\":11,\"clientTimestamp\":\"$(ago 12)\"},
  {\"id\":\"$(uuid)\",\"type\":\"note\",\"text\":\"Nota privada del árbitro\",\"clientTimestamp\":\"$(ago 10)\"}
]"
for attempt in 1 2 3; do
  call 200 POST "/matches/$MATCH_ID/events" "{\"deviceId\":\"web-curl\",\"sentAt\":\"$(now)\",\"events\":$EVENTS}"
done
[[ "$(jq '[.results[].status] | unique' -c "$OUT")" == '["duplicate"]' ]] || { echo '✗ resend was not all duplicates' >&2; exit 1; }

echo "== 6. Undo the goal (a void event), then read new events with ?since="
call 200 POST "/matches/$MATCH_ID/events" "{\"deviceId\":\"web-curl\",\"sentAt\":\"$(now)\",\"events\":[{\"id\":\"$(uuid)\",\"type\":\"void\",\"voidsEventId\":\"$GOAL_ID\",\"clientTimestamp\":\"$(now)\"}]}"
[[ "$(jq .state.score.home "$OUT")" == 0 ]] || { echo '✗ void did not undo the goal' >&2; exit 1; }
call 200 GET "/matches/$MATCH_ID/events?since=5"
call 200 GET "/matches/$MATCH_ID?include=timeline"

echo "== 7. Public live view (no cookie; notes are hidden)"
call 200 GET "/matches/$MATCH_ID/live?token=$LIVE_TOKEN" '' -b /dev/null -D "$JAR.h"
grep -q 'Nota privada' "$OUT" && { echo '✗ live view leaked a note' >&2; exit 1; }
ETAG="$(grep -i '^etag:' "$JAR.h" | cut -d' ' -f2- | tr -d '\r')"; rm -f "$JAR.h"
call 304 GET "/matches/$MATCH_ID/live?token=$LIVE_TOKEN" '' -b /dev/null -H "If-None-Match: $ETAG"
call 404 GET "/matches/$MATCH_ID/live?token=wrong" '' -b /dev/null

echo "== 8. Watch pairing: watch asks for a code → owner approves → watch polls"
WATCH_ID="curl-watch-$RANDOM"
call 201 POST /pairing/request "{\"deviceId\":\"$WATCH_ID\",\"deviceName\":\"Reloj de prueba\"}" -b /dev/null
CODE="$(jq -r .code "$OUT")"; POLL_TOKEN="$(jq -r .pollToken "$OUT")"
echo "   Code shown on the watch: $CODE"
call 202 POST /pairing/poll "{\"code\":\"$CODE\",\"pollToken\":\"$POLL_TOKEN\"}" -b /dev/null
call 200 POST /pairing/approve "{\"code\":\"$CODE\"}"
call 200 POST /pairing/poll "{\"code\":\"$CODE\",\"pollToken\":\"$POLL_TOKEN\"}" -b /dev/null
DEVICE_KEY="$(jq -r .deviceKey "$OUT")"; KEY_ID="$(jq -r .keyId "$OUT")"
call 410 POST /pairing/poll "{\"code\":\"$CODE\",\"pollToken\":\"$POLL_TOKEN\"}" -b /dev/null

echo "== 9. As the watch: quick match (no rosters) + events"
AUTH=(-b /dev/null -H "Authorization: Bearer $DEVICE_KEY")
QUICK_ID="$(uuid)"
call 201 POST /matches "{\"id\":\"$QUICK_ID\"}" "${AUTH[@]}"
call 200 POST /matches "{\"id\":\"$QUICK_ID\"}" "${AUTH[@]}"
call 200 POST "/matches/$QUICK_ID/events" "{\"sentAt\":\"$(now)\",\"events\":[{\"id\":\"$(uuid)\",\"type\":\"period_start\",\"period\":1,\"clientTimestamp\":\"$(ago 2)\"},{\"id\":\"$(uuid)\",\"type\":\"goal\",\"team\":\"away\",\"clientTimestamp\":\"$(ago 1)\"}]}" "${AUTH[@]}"
call 403 PATCH "/matches/$QUICK_ID" '{"tournament":"no permitido"}' "${AUTH[@]}"

echo "== 10. Errors have one format"
call 422 POST /matches '{"periodMinutes":0,"deviceId":"web-curl"}'
call 404 GET "/matches/$(uuid)"

echo "== 11. Clean up: revoke the test device, delete test data"
call 200 GET /devices
call 204 DELETE "/devices/$KEY_ID"
call 401 GET /matches '' -b /dev/null -H "Authorization: Bearer $DEVICE_KEY"
call 204 DELETE "/matches/$QUICK_ID"
if [[ "${KEEP_DATA:-0}" != 1 ]]; then
  call 204 DELETE "/matches/$MATCH_ID"
  call 204 DELETE "/teams/$HOME_ID"
  call 204 DELETE "/teams/$AWAY_ID"
fi
call 204 DELETE /session

printf '\n✓ All examples behaved as documented.\n'
