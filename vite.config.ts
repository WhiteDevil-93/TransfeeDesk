import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["branding/icons/favicon.ico"],
      manifest: {
        name: "BaraBridge",
        short_name: "BaraBridge",
        description: "Send, receive and track referrals, consults and transfers.",
        start_url: "/#/",
        shortcuts: [
          { name: "Receiving staff", url: "/#/login", description: "Open the referral desk" },
          { name: "Referring clinician", url: "/#/portal", description: "Send and track your consults" },
        ],
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        theme_color: "#0B7F75",
        background_color: "#ffffff",
        icons: [
          { src: "branding/icons/app-teal-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "branding/icons/app-teal-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "branding/icons/maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        importScripts: ["push-sw.js"],
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        globIgnores: ["branding/wallpapers/**", "branding/source/**", "branding/social/**"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/branding(?:\/|$)/],
        runtimeCaching: [
          { urlPattern: /^\/api\//, handler: "NetworkOnly" },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  base: "./",
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
