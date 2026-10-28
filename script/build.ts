import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile } from "node:fs/promises";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "express",
  "ws",
  "zod",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });

  console.log("building HPCSA refresh worker...");
  await esbuild({
    entryPoints: ["script/hpcsa-scrape.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/hpcsa-scrape.cjs",
    external: externals,
    logLevel: "info",
  });

  console.log("building data re-encryption tool...");
  await esbuild({
    entryPoints: ["script/reencrypt-data.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/reencrypt-data.cjs",
    external: externals,
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
