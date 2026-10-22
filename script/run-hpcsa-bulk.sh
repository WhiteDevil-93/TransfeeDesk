#!/usr/bin/env bash
# Type-check the HPCSA scraper, then run a bulk A-Z (or given letters) sweep.
# The sweep is resumable: state lives in script/hpcsa_bulk_state.json, so
# re-running after an interruption picks up where it stopped.
#
# Usage:
#   bash script/run-hpcsa-bulk.sh            # sweep all letters not yet done
#   bash script/run-hpcsa-bulk.sh C D        # sweep only these letters
#   SKIP_DB=1 bash script/run-hpcsa-bulk.sh A  # search only, print rows
cd "$(dirname "$0")/.."
./node_modules/.bin/tsc --noEmit --esModuleInterop --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck script/hpcsa-scrape.ts || exit 1
set -a; source .env; set +a
exec npx tsx script/hpcsa-scrape.ts --bulk "$@"
