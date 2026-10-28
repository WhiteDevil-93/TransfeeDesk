# PR #5 branding in the application

The canonical package remains in `branding/`, with its original checksums and
offline gallery. `script/sync-branding.ts` copies it to the generated, ignored
`client/public/branding/` directory before production builds and `npm run dev`.
Builds publish the complete gallery at `/branding/` and preserve the package bytes.
Do not edit generated copies; update the canonical package and its inventory.

The app uses the teal SVG mark on light surfaces and the white mark in the dark
receiving-workspace header. Its UX Pilot layouts, navigation, clinical priority
colours, roles and forms remain unchanged. Wallpapers are downloadable artwork;
they are not clinical-screen backgrounds.

Browser favicon, 180px Apple icon, 192/512px PWA icons, maskable icon and push
notification icon now use PR #5 assets. The manifest uses the package's teal
theme colour. Wallpapers and social exports are excluded from the service-worker
precache so installing the clinical app does not download the large artwork.
Existing legacy root icon URLs remain available to older clients.

After `npm run build`, run `node tests/branding-build.mjs` to verify all 100
checksummed package files, gallery links, PNG dimensions, icon references and
precache boundaries. `tests/navigation-smoke.mjs` also checks that rendered brand
images load during real app journeys. With the built navigation fixture running,
`node tests/branding-browser.mjs` verifies the real service worker serves the
gallery online/offline and downloads wallpaper image bytes rather than the SPA
shell. Branding URLs are excluded from the SPA navigation fallback.
Installed launcher-icon refresh timing is
controlled by the phone/browser; new installations use the new manifest assets.
