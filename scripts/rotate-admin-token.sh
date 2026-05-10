#!/usr/bin/env bash
# Rotate ADMIN_DASHBOARD_TOKEN (powers /admin/health bookmark auth).
#
# Generates a fresh 32-byte hex token, pipes it into `wrangler secret put`
# for one or both envs, prints the bookmark URL with the new token, and on
# macOS copies the prod URL to the clipboard for easy bookmarking.
#
# Usage:
#   scripts/rotate-admin-token.sh                # both envs
#   scripts/rotate-admin-token.sh staging        # staging only
#   scripts/rotate-admin-token.sh prod           # prod only
#
# Override worker URLs via env (defaults are this account's workers.dev URLs):
#   PROD_URL=https://example.com STAGING_URL=https://staging.example.com $0
#
# The printed URL contains the token in the query string — treat the
# terminal output and your clipboard like any other shared secret.

set -euo pipefail

PROD_URL="${PROD_URL:-https://ssi-scoreboard.long-sun-fac0.workers.dev}"
STAGING_URL="${STAGING_URL:-https://ssi-scoreboard-staging.long-sun-fac0.workers.dev}"

TARGET="${1:-both}"

usage() {
  sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
}

case "$TARGET" in
  staging|prod|both) ;;
  -h|--help|help) usage; exit 0 ;;
  *) usage >&2; exit 1 ;;
esac

command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 1; }
command -v pnpm >/dev/null || { echo "pnpm is required" >&2; exit 1; }

TOKEN=$(openssl rand -hex 32)

set_secret() {
  local label=$1
  shift
  echo "-> setting ADMIN_DASHBOARD_TOKEN ($label)..." >&2
  printf '%s' "$TOKEN" | pnpm exec wrangler secret put ADMIN_DASHBOARD_TOKEN "$@" >/dev/null
}

if [ "$TARGET" = "staging" ] || [ "$TARGET" = "both" ]; then
  set_secret staging --env staging
fi
if [ "$TARGET" = "prod" ] || [ "$TARGET" = "both" ]; then
  set_secret prod
fi

SHA=$(printf '%s' "$TOKEN" | shasum -a 256 | cut -c1-12)

echo
echo "ADMIN_DASHBOARD_TOKEN rotated"
echo "  length:    ${#TOKEN}"
echo "  sha256/12: $SHA"
echo "  tail:      ...${TOKEN: -2}"
echo
echo "Bookmark URL(s):"
if [ "$TARGET" = "staging" ] || [ "$TARGET" = "both" ]; then
  echo "  staging: $STAGING_URL/admin/health?token=$TOKEN"
fi
if [ "$TARGET" = "prod" ] || [ "$TARGET" = "both" ]; then
  echo "  prod:    $PROD_URL/admin/health?token=$TOKEN"
fi

# macOS: copy the most useful URL to clipboard (prod takes precedence).
if command -v pbcopy >/dev/null; then
  if [ "$TARGET" = "prod" ] || [ "$TARGET" = "both" ]; then
    printf '%s' "$PROD_URL/admin/health?token=$TOKEN" | pbcopy
    echo
    echo "(prod URL copied to clipboard)"
  elif [ "$TARGET" = "staging" ]; then
    printf '%s' "$STAGING_URL/admin/health?token=$TOKEN" | pbcopy
    echo
    echo "(staging URL copied to clipboard)"
  fi
fi

unset TOKEN
