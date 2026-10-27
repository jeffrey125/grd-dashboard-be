#!/usr/bin/env bash
set -euo pipefail

origin=${1:?Usage: check-app-platform.sh ORIGIN}
response_dir=$(mktemp -d)
trap 'rm -rf "$response_dir"' EXIT

fetch() {
  curl --fail --silent --show-error --connect-timeout 5 --max-time 15 \
    --retry 5 --retry-all-errors --retry-delay 2 --retry-max-time 90 \
    "$origin$1" --output "$response_dir/$2"
}

fetch /api/v1/health/ready ready.json
jq -e '.status == "ok"' "$response_dir/ready.json" >/dev/null
fetch /api/v1/features features.json
jq -e '.quoteComparisonEnabled == false' "$response_dir/features.json" >/dev/null
status=$(curl --silent --show-error --connect-timeout 5 --max-time 15 \
  --output /dev/null --write-out '%{http_code}' "$origin/api/v1/shipments")
[[ "$status" == 401 ]] || { echo 'Unauthenticated shipment access did not return 401.' >&2; exit 1; }
printf 'API readiness, tracking-only configuration and auth boundary passed.\n'
