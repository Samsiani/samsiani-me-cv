#!/usr/bin/env bash
# Every self-hosted font download, with its expected size. Run on a workstation, never on the server.
# Fonts keep fixed descriptive names and are never overwritten with different bytes: a changed font gets a new name.
set -euo pipefail
cd "$(dirname "$0")/../src/fonts"
fetch() { # url file expected-bytes
  curl -sS -o "$2" "$1"
  local got; got=$(wc -c < "$2" | tr -d ' ')
  if [ "$got" != "$3" ]; then echo "WARN $2: $got bytes, expected $3 (Google may have updated the file; check it before committing)"; else echo "ok   $2 ($got bytes)"; fi
}
# Studio (M3): Archivo variable, width 100-112 % and weight axes, latin subset
fetch https://fonts.gstatic.com/s/archivo/v25/k3kQo8UDI-1M0wlSfdnoLmvDIaI.woff2 archivo-latin-wdth-wght.woff2 90096
curl -sS -o OFL-Archivo.txt https://raw.githubusercontent.com/Omnibus-Type/Archivo/master/OFL.txt
