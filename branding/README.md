# BaraBridge branding package

Prepared 28 October 2026 from the existing [BaraBridge source](https://github.com/WhiteDevil-93/TransfeeDesk). Open **index.html** for the asset gallery.

## Included

- Desktop and phone wallpapers, with original generated artwork preserved. Sized exports are resampled; export resolution is not a claim of native generated detail.
- Teal, blue, ink and white transparent logo marks and horizontal wordmarks, SVG and PNG.
- Teal, blue and dark app icons, PNG sizes 16 through 1024; 180px Apple touch icon, 192/512px PWA sizes, a separate full-bleed maskable icon, and multi-resolution Windows/favicon ICO.
- Eight matching workflow icons: referral, consult, transfer, roster, team, location, notification and follow-up.
- MEU, TEU and SEU unit badges; referring-clinician, receiving-team and administrator role badges.
- GitHub/social banner, repeating transfer pattern, palette tokens, reproducible vector export script and checksums.

## Identity

Retain the existing rounded-square opposing-arrow mark from `client/src/App.tsx` (32-unit geometry). It represents communication in both directions. Artwork here regularizes the vector exports; it does not replace deployed icons automatically. The older PWA PNG has different frame proportions and stroke widths.

| Colour | Hex | Use |
|---|---|---|
| Teal | #0B7F75 | Main brand colour, rounded from the existing CSS primary |
| Sky blue | #0284C7 | Existing PWA colour, supporting identity |
| Ink | #0F172A | Dark backgrounds and text |
| Mint | #CCFBF1 | Decorative highlights |
| Paper | #F8FAFC | Light surfaces |
| Slate | #475569 | Secondary text |

Use Inter in the product where available (the source CSS names it). Portable artwork uses Arial/system sans-serif for reliable local rendering. No font binaries are bundled. SVG wordmarks contain live text; convert to outlines in your design tool before sending to a printer if exact typography must be locked.

Keep at least one quarter of the symbol width clear around a logo. Minimum recommended symbol size: 24px; the 16px favicon is supplied for browser use. Do not stretch, rotate, recolour individual arrows or add effects to the core logo. Use white on dark backgrounds, teal or ink on light. White marks are transparent and appear empty on white surfaces.

Badges identify units and roles visually. They are not proof of account permissions, clinical credentials, hospital endorsement or regulatory certification. No endorsement seal or certification claim is included. Decorative brand colours do not redefine clinical priority/status colours.

## Using the assets

Use SVG for scalable web/print graphics and PNG for wallpapers, social tools and app packaging. The maskable icon keeps the mark within its central safe zone. PNG icons have transparent rounded corners except the full-bleed maskable icon. No signed Android/iOS build or deployed app change is included.

The supplied banner text, “Referrals. Consults. Transfers.”, is a descriptive line based on the application's existing description, not a new clinical promise. Generated wallpaper symbols are illustrative interpretations; the SVG/PNG logo files are the canonical geometry.

## Rebuild and evidence

`build-brand.cjs` generates vector assets and PNG/ICO exports with Node.js and `sharp`. Its bundled-runtime path is local to this workstation; replace the require path with your installed `sharp` package elsewhere. `finish-brand.cjs` creates sized wallpaper exports, the gallery, a contact sheet and a SHA-256 inventory. Run both from this folder. Image generation prompts are in `prompts.md`; those two source artworks require image generation and are not recreated by the Node scripts.

Verification: PNG decode and dimensions, SVG XML structure through sharp rendering, representative transparent backgrounds, maskable margin, ICO directory entries, and gallery image references. Visual review uses `contact-sheet.jpg` and the original wallpapers. No application code or clinical workflow is changed.
