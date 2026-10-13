#!/usr/bin/env bash
# Deploys the production Edge Functions to Supabase and sets their shared secrets.
# Needs: Node 22+, a Supabase personal access token (Dashboard → Account → Access Tokens).
#   SUPABASE_ACCESS_TOKEN=sbp_... ./scripts/deploy-edge-functions.sh [project-ref]
# Secrets: MEDIA_CRON_SECRET / MEDIA_ADMIN_SECRET are taken from the environment, or generated.
# Generated values are written to .secrets/edge-secrets.env (git-ignored) so the cron secret can be
# copied into Vault (see release/launch/LAUNCH.md step 4). Nothing secret is printed to the terminal.
set -euo pipefail
cd "$(dirname "$0")/.."
REF="${1:-refwrdfxbhcsguweicle}"
CLI="npx --yes supabase@2.116.0"
: "${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN (Supabase Dashboard → Account → Access Tokens)}"
# Scaffolds that only return 501 (refresh-live-place, sync-korea-open-data, sync-ticketmaster, sync-wikidata) are not deployed.
FUNCTIONS=(delete-account discover-city-candidates sync-place-media refresh-media-rights cache-commons-media promote-candidate admin-discovery-command sync-seoul-cultural-events sync-global-places)

work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
mkdir -p "$work/supabase/functions"
cp -R edge-functions/. "$work/supabase/functions/"
printf 'project_id = "%s"\n' "$REF" > "$work/supabase/config.toml"
for f in "${FUNCTIONS[@]}"; do
  # Auth is enforced inside each function (user JWT via auth.getUser, or x-aol-* shared secrets),
  # and the new sb_publishable_/sb_secret_ keys are not JWTs, so gateway JWT verification is off.
  printf '\n[functions.%s]\nverify_jwt = false\n' "$f" >> "$work/supabase/config.toml"
done

mkdir -p .secrets; chmod 700 .secrets
secrets_file=.secrets/edge-secrets.env
[ -f "$secrets_file" ] && . "$secrets_file"
MEDIA_CRON_SECRET="${MEDIA_CRON_SECRET:-$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")}"
MEDIA_ADMIN_SECRET="${MEDIA_ADMIN_SECRET:-$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")}"
umask 077; printf 'MEDIA_CRON_SECRET=%s\nMEDIA_ADMIN_SECRET=%s\n' "$MEDIA_CRON_SECRET" "$MEDIA_ADMIN_SECRET" > "$secrets_file"

echo "Setting function secrets on $REF…"
$CLI secrets set --project-ref "$REF" --env-file "$secrets_file" --workdir "$work"
for f in "${FUNCTIONS[@]}"; do
  echo "Deploying $f…"
  $CLI functions deploy "$f" --project-ref "$REF" --use-api --no-verify-jwt --workdir "$work"
done
echo "Done. Secrets saved in $secrets_file (git-ignored). Next: release/launch/LAUNCH.md step 4 (Vault + cron)."
