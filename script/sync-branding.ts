import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function syncBranding() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const target = path.join(root, "client/public/branding");
  if (path.relative(root, path.resolve(target)) !== path.join("client", "public", "branding")) throw new Error("Unexpected branding output path");
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await cp(path.join(root, "branding"), target, { recursive: true });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await syncBranding();
