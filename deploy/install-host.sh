#!/usr/bin/env bash
set -euo pipefail
# This script changes only TransferDesk paths and its two public HTTP ports.
# Caddy must already be installed from its official repository.
release=${1:?Usage: install-host.sh RELEASE_ID}
[[ "$release" =~ ^[a-zA-Z0-9_-]+$ ]] || exit 2
test -f /home/ubuntu/transferdesk-release.tar.gz
if ! id transferdesk >/dev/null 2>&1; then
  sudo useradd --system --home-dir /var/lib/transferdesk --shell /usr/sbin/nologin transferdesk
fi
sudo install -d -m 755 /opt/transferdesk/releases
sudo install -d -m 700 -o transferdesk -g transferdesk /var/lib/transferdesk
node_version=v24.22.1
case "$(uname -m)" in
  aarch64|arm64) node_arch=arm64 ;;
  x86_64|amd64) node_arch=x64 ;;
  *) echo "Unsupported CPU architecture: $(uname -m)" >&2; exit 2 ;;
esac
node_dist="node-$node_version-linux-$node_arch"
if [ ! -x "/opt/transferdesk/node-$node_version/bin/node" ]; then
  stage=$(mktemp -d /tmp/transferdesk-node.XXXXXX)
  trap 'rm -f "$stage/$node_dist.tar.xz" "$stage/SHASUMS256.txt"; rmdir "$stage"' EXIT
  curl -fsSL "https://nodejs.org/dist/$node_version/$node_dist.tar.xz" -o "$stage/$node_dist.tar.xz"
  curl -fsSL "https://nodejs.org/dist/$node_version/SHASUMS256.txt" -o "$stage/SHASUMS256.txt"
  (cd "$stage" && grep " $node_dist.tar.xz$" SHASUMS256.txt | sha256sum -c -)
  sudo tar -xJf "$stage/$node_dist.tar.xz" -C /opt/transferdesk
  sudo mv "/opt/transferdesk/$node_dist" "/opt/transferdesk/node-$node_version"
fi
sudo ln -sfn "/opt/transferdesk/node-$node_version" /opt/transferdesk/node
target="/opt/transferdesk/releases/$release"
test ! -e "$target"
sudo install -d -m 755 -o ubuntu -g ubuntu "$target"
tar -xzf /home/ubuntu/transferdesk-release.tar.gz -C "$target"
cd "$target"
PATH=/opt/transferdesk/node/bin:$PATH /opt/transferdesk/node/bin/npm ci --omit=dev --ignore-scripts --no-audit --no-fund
sudo chown -R root:root "$target"
sudo chmod -R go-w "$target"
if [ -f "$target/data.js" ]; then sudo chown root:transferdesk "$target/data.js"; sudo chmod 640 "$target/data.js"; fi
sudo ln -sfn "$target" /opt/transferdesk/current
if [ ! -e /var/lib/transferdesk/hpcsa_surnames.txt ]; then
  sudo install -m 600 -o transferdesk -g transferdesk script/hpcsa_surnames.txt /var/lib/transferdesk/hpcsa_surnames.txt
fi
sudo install -m 644 deploy/transferdesk.service deploy/transferdesk-setup.service deploy/transferdesk-hpcsa.service deploy/transferdesk-hpcsa.timer /etc/systemd/system/
sudo cp -n /etc/caddy/Caddyfile "/var/lib/transferdesk/Caddyfile-before-$release"
sudo install -m 644 deploy/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo iptables-save | sudo tee "/var/lib/transferdesk/iptables-before-$release" >/dev/null
for port in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$port" -m conntrack --ctstate NEW -j ACCEPT 2>/dev/null ||
    sudo iptables -I INPUT 4 -p tcp --dport "$port" -m conntrack --ctstate NEW -j ACCEPT
done
if [ -d /etc/iptables ]; then sudo iptables-save | sudo tee /etc/iptables/rules.v4 >/dev/null; fi
sudo systemctl daemon-reload
sudo systemctl enable transferdesk.service
sudo systemctl reload caddy
echo 'TransferDesk runtime installed. Clinical API remains gated on verified credentials.'
