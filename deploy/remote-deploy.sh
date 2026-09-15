#!/usr/bin/env bash
# Usage: bash -s -- <SHA>   (stdin from the workflow's own checkout; runs as root)
# Root never sources, executes, chowns, chmods or rsyncs anything under $SITE_HOME; every command
# that writes there runs as the site user.
set -euo pipefail
SHA="$1"
APP=/opt/samsiani-admin; R="$APP/releases/$SHA"; ECO="$APP/shared/ecosystem.config.cjs"
for f in deploy.env admin.env ecosystem.config.cjs; do [ -s "$APP/shared/$f" ] || { echo "$APP/shared/$f missing" >&2; exit 1; }; done
set -a; . "$APP/shared/deploy.env"; set +a        # SITE_USER NODE_BIN SITE_HOME WEB_ROOT PORT (root-owned file)
PORT="${PORT:-3097}"
as_site() { runuser -u "$SITE_USER" -- env NODE_ENV=production SITE_HOME="$SITE_HOME" WEB_ROOT="$WEB_ROOT" PORT="$PORT" "$NODE_BIN" "$@"; }
healthy() { curl -fsS "http://127.0.0.1:$PORT/admin/api/health" | grep -q "\"release\":\"$1\""; }

# 1. code: root-owned, readable by everyone, writable by nobody else
chown -R root:root "$R"; chmod -R u=rwX,go=rX "$R"

# 2. an operator disabled the admin: install only
if [ -e "$APP/shared/DISABLED" ]; then
  echo "::warning::admin disabled; release $SHA installed but not started"; exit 0
fi

# 3. data directories: created by the site user in its own home, never by root
runuser -u "$SITE_USER" -- install -d -m 700 "$SITE_HOME/data"
runuser -u "$SITE_USER" -- install -d -m 755 "$SITE_HOME/builds"

# 4. preflight with the new code; schema migration only with the service stopped
as_site "$R/admin/server/cli.mjs" verify
MIGRATED=0; rc=0
as_site "$R/admin/server/cli.mjs" migrate --dry-run || rc=$?
case "$rc" in
  0) ;;
  10) pm2 stop samsiani-admin || true
      as_site "$R/admin/server/cli.mjs" backup --name="pre-migrate-$SHA"
      as_site "$R/admin/server/cli.mjs" migrate
      MIGRATED=1 ;;
  *) echo "migrate --dry-run failed ($rc)" >&2; exit 1 ;;
esac
as_site "$R/admin/server/cli.mjs" init             # first boot seeds data/; never overwrites; never migrates

# 5. flip the release and (re)start from the root-owned ecosystem file
PREV="$(readlink -f "$APP/current" 2>/dev/null || true)"
ln -sfn "$R" "$APP/current.tmp" && mv -Tf "$APP/current.tmp" "$APP/current"
pm2 startOrReload "$ECO" --update-env

# 6. the new release must report its own sha within 20 s, else revert
ok=0
for _ in $(seq 1 20); do healthy "$SHA" && { ok=1; break; }; sleep 1; done
if [ "$ok" != 1 ]; then
  echo "health check failed for $SHA; reverting" >&2
  if [ -n "$PREV" ] && [ -d "$PREV" ]; then
    pm2 stop samsiani-admin || true
    if [ "$MIGRATED" = 1 ]; then
      as_site "$PREV/admin/server/cli.mjs" restore-backup --file="$SITE_HOME/data/backups/pre-migrate-$SHA.json.gz" --part=all
    fi
    ln -sfn "$PREV" "$APP/current.tmp" && mv -Tf "$APP/current.tmp" "$APP/current"
    pm2 startOrReload "$ECO" --update-env
  fi
  exit 1
fi

# 7. re-render the public site from the server's site.json with the new templates
as_site "$APP/current/admin/server/cli.mjs" publish --source=published --reason=deploy --if-changed

# 8. persist and prune (keep 5 releases; never current or previous)
pm2 save
CUR="$(readlink -f "$APP/current")"
ls -1dt "$APP/releases"/*/ | tail -n +6 | while read -r d; do
  d="${d%/}"; [ "$d" = "$CUR" ] || [ "$d" = "$PREV" ] || rm -rf -- "$d"
done

# 9. vhost probe through the local OLS (warning only; the health endpoint needs no edge header)
code="$(curl -sk -o /dev/null -w '%{http_code}' --resolve samsiani.me:443:127.0.0.1 https://samsiani.me/admin/api/health || true)"
[ "$code" = 200 ] || echo "::warning::/admin/ is not proxied by OLS (HTTP $code); re-apply deploy/ols-admin-context.conf"
