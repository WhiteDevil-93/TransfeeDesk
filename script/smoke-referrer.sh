#!/usr/bin/env bash
# Smoke-test the referrer card flow: upload card, owner sees it, approve, card retrievable.
set -e
cd "$(dirname "$0")/.."
API=http://127.0.0.1:5000
tok() { curl -s -X POST $API/api/login -H "Content-Type: application/json" -d "{\"username\":\"$1\",\"password\":\"$2\"}" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).token || 'LOGIN_FAILED'"; }
RT=$(tok drtest1 ReferrerPass123)
echo "referrer token: ${RT:0:15}..."
OT=$(tok thendricks transferdesk-local-2026)
echo "owner token: ${OT:0:15}..."

# 1x1 PNG as base64 (tiny test image)
B64=$(python3 -c "
import base64, struct, zlib
sig = b'\x89PNG\r\n\x1a\n'
def chunk(t, d):
    c = struct.pack('>I', len(d)) + t + d
    return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
png = sig + chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b'\x00\xff\x00\x00')) + chunk(b'IEND', b'')
print(base64.b64encode(png).decode())
")

echo "--- upload card ---"
curl -s -X POST $API/api/referrer/card -H "Authorization: Bearer $RT" -H "Content-Type: application/json" -d "{\"image\":{\"name\":\"card.png\",\"mime\":\"image/png\",\"data\":\"$B64\"}}"
echo
echo "--- owner pending list ---"
curl -s $API/api/pending-referrers -H "Authorization: Bearer $OT"
echo
PENDING_ID=$(curl -s $API/api/pending-referrers -H "Authorization: Bearer $OT" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8'))[0].id")
echo "--- fetch card (owner) ---"
curl -s $API/api/pending-referrers/$PENDING_ID/card -H "Authorization: Bearer $OT" | node -pe "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); j.data ? 'card base64 len '+j.data.length : JSON.stringify(j)"
echo "--- approve ---"
curl -s -X POST $API/api/pending-referrers/$PENDING_ID/approve -H "Authorization: Bearer $OT"
echo
echo "--- verify status in db ---"
