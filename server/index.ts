import "dotenv/config";
import express, { Response, NextFunction } from 'express';
import type { Request } from 'express';
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "node:http";
import { runBulkExport } from "../script/hpcsa-scrape";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Strict-Transport-Security", "max-age=31536000");
  next();
});
app.use(
  express.json({
    limit: "9mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // Refresh the HPCSA iRegister snapshot every 14 days (the referrer
  // verification table). A full A-Z bulk export — resumable, auto-splits on
  // 500s — keeps the table covering the whole public register. Best-effort:
  // a failed run is logged and retried on the next interval; it never takes
  // the app down.
  const HPCSA_REFRESH_MS = 14 * 24 * 60 * 60 * 1000;
  const HPCSA_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  let hpcsaBusy = false;
  const hpcsaRefresh = async () => {
    if (hpcsaBusy) return;
    hpcsaBusy = true;
    try {
      log("HPCSA iRegister bulk export started");
      const rows = await runBulkExport(HPCSA_LETTERS, false);
      log(`HPCSA iRegister bulk export finished: ${rows} rows`);
    } catch (e) {
      console.error("HPCSA bulk export failed:", e);
    } finally {
      hpcsaBusy = false;
    }
  };
  const hpcsaTimer = setInterval(hpcsaRefresh, HPCSA_REFRESH_MS);
  hpcsaTimer.unref();
  // HPCSA_NOW=1 forces a refresh shortly after boot (dev/testing).
  if (process.env.HPCSA_NOW === "1") setTimeout(hpcsaRefresh, 15000);

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  // reusePort (SO_REUSEPORT) is only supported on Linux/macOS; on Windows it
  // makes listen() fail with ENOTSUP, so only set it where the OS supports it.
  const reusePort = process.platform !== "win32";
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
