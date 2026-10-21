#!/bin/bash
# Installs or updates the Attila watch from this checkout. Run it as root on the server:
#
#   sudo SERVICE_USER=<account> watch/deploy/install.sh
#
# SERVICE_USER runs the watch, can read its secrets and owns the IPFS publish directory. The judge
# user created here runs everything that touches a site, and can read no secret.
set -euo pipefail

SERVICE_USER=${SERVICE_USER:?set SERVICE_USER to the account that runs the watch}
JUDGE_USER=attila-judge
NODE=${NODE:-/usr/local/bin/node}
ENABLE_TIMER=${ENABLE_TIMER:-1}
SRC=$(cd "$(dirname "$0")/../.." && pwd)
OPT=/opt/attila-watch
APP=$OPT/app

[ "$(id -u)" = 0 ] || { echo "run this as root"; exit 1; }
"$NODE" -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 18) ? 0 : 1)' \
  || { echo "Node 22.18 or newer is needed at $NODE"; exit 1; }

# srt's sandbox (bubblewrap, socat, ripgrep), and the libraries Chromium's headless shell links.
DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends \
  bubblewrap socat ripgrep rsync git \
  libatk1.0-0t64 libatk-bridge2.0-0t64 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
  libasound2t64 libatspi2.0-0t64 fonts-liberation

id "$JUDGE_USER" >/dev/null 2>&1 \
  || useradd --system --home-dir "/var/lib/$JUDGE_USER" --create-home --shell /usr/sbin/nologin "$JUDGE_USER"
chmod 700 "/var/lib/$JUDGE_USER"
# The service user reads what the judge user fetched; the judge user is in no group of the service user.
usermod -aG "$JUDGE_USER" "$SERVICE_USER"
SERVICE_HOME=$(getent passwd "$SERVICE_USER" | cut -d: -f6)

install -d -o root -g root -m 0755 "$OPT" "$OPT/bin" "$OPT/browsers" "$APP"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0700 /var/lib/attila-watch
install -d -o "$JUDGE_USER" -g "$JUDGE_USER" -m 2770 /var/attila-jobs
install -d -o root -g "$SERVICE_USER" -m 0750 /etc/attila-watch
if [ ! -f /etc/attila-watch/secrets.env ]; then
  printf '%s\n' "TELEGRAM_BOT_TOKEN=" "TELEGRAM_CHAT_ID=" "CLAUDE_CODE_OAUTH_TOKEN=" "GITHUB_TOKEN=" \
    | install -o root -g "$SERVICE_USER" -m 0640 /dev/stdin /etc/attila-watch/secrets.env
fi

# The code is a copy of this checkout's src/ and watch/; node_modules survive an update.
rsync -a --delete --exclude node_modules --exclude test "$SRC/src" "$SRC/watch" "$APP/"
install -m 0644 "$SRC/package.json" "$SRC/package-lock.json" "$APP/"
(cd "$APP" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
if [ -f "$APP/watch/package-lock.json" ]; then
  (cd "$APP/watch" && npm ci --no-audit --no-fund --loglevel=error)
else
  (cd "$APP/watch" && npm install --no-audit --no-fund --loglevel=error)
fi
PLAYWRIGHT_BROWSERS_PATH="$OPT/browsers" "$APP/watch/node_modules/.bin/playwright" install chromium-headless-shell
chmod -R a+rX "$APP" "$OPT/browsers"

install -m 0755 "$SRC/watch/deploy/attila-watch-login" "$OPT/bin/attila-watch-login"

sed -e "s#@SERVICE_USER@#$SERVICE_USER#g" -e "s#@SERVICE_HOME@#$SERVICE_HOME#g" \
  "$SRC/watch/deploy/attila-watch.service" > /etc/systemd/system/attila-watch.service
install -m 0644 "$SRC/watch/deploy/attila-watch.timer" /etc/systemd/system/attila-watch.timer
systemctl daemon-reload
if [ "$ENABLE_TIMER" = 1 ]; then systemctl enable --now attila-watch.timer; fi

echo "Installed. Secrets: /etc/attila-watch/secrets.env. Claude sign-in: $OPT/bin/attila-watch-login"
