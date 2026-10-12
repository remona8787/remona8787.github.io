#!/usr/bin/env bash
set -euo pipefail

read -r -p "Supabase project URL (https://xxxx.supabase.co): " SUPABASE_URL
read -r -s -p "MEDIA_ADMIN_SECRET: " MEDIA_ADMIN_SECRET
echo

SUPABASE_URL="${SUPABASE_URL%/}"

run_city () {
  CITY="$1"
  LIMIT="$2"
  echo
  echo "=== Discovering ${CITY} ==="
  curl -sS -X POST "${SUPABASE_URL}/functions/v1/discover-city-candidates" \
    -H "Content-Type: application/json" \
    -H "x-aol-media-admin-secret: ${MEDIA_ADMIN_SECRET}" \
    -d "{\"city_code\":\"${CITY}\",\"limit_cities\":1,\"candidate_limit_per_city\":${LIMIT}}"
  echo
}

run_city SEOUL 100
run_city TOKYO 120
run_city NEWYORK 120
echo "Bootstrap discovery complete."
