import express, { type Express } from "express";

// Vite's dev server injects inline scripts, so the policy is only enforced on built assets.
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org",
  "connect-src 'self'", "worker-src 'self'", "manifest-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
].join("; ");

// Only routes that carry base64 images get the large body limit.
export const IMAGE_BODY_ROUTES = [/^\/api\/referrals$/, /^\/api\/portal\/followup$/, /^\/api\/referrer\/card$/, /^\/api\/referrer\/referrals\/\d+\/followup$/];

export function applyHttpHardening(app: Express, production: boolean) {
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Frame-Options", "DENY");
    if (production) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
      res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    }
    next();
  });
  const largeJson = express.json({ limit: "9mb" });
  const smallJson = express.json({ limit: "100kb" });
  app.use((req, res, next) => (req.method === "POST" && IMAGE_BODY_ROUTES.some(route => route.test(req.path)) ? largeJson : smallJson)(req, res, next));
  app.use(express.urlencoded({ extended: false, limit: "100kb" }));
}
