#!/usr/bin/env bash
# Type-check the HPCSA scraper, then run it (pass surnames as args).
cd "$(dirname "$0")/.."
./node_modules/.bin/tsc --noEmit --esModuleInterop --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck script/hpcsa-scrape.ts || exit 1
set -a; source .env; set +a
exec npx tsx script/hpcsa-scrape.ts "$@"
