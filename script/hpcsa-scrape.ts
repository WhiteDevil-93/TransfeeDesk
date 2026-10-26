// HPCSA iRegister scraper.
//
// Search endpoint (public, no login):
//   POST https://hpcsaonline.custhelp.com/cc/ReportController/getDataFromRnow
//   Content-Type: application/x-www-form-urlencoded  (JSON body returns 401/empty)
//   body: regNumber, firstName, middleName, surName, city, postalCode, register, category
//   - wildcard search: wrap the value in *...* (server does case-insensitive LIKE)
//   - register: optional profession register name (e.g. "MEDICAL PRACTITIONER")
// Response rows: [title, surname, full_name, registration_number, city, postal_code, categories, status, ...]
// No paging: a surname search returns all matches in one response (723 rows for DUBE).
//
// The register has ~600k entries, so a full dump by surname search is not
// practical in one pass. Strategy: keep a surname checklist
// (script/hpcsa_surnames.txt, one per line, uppercase) and upsert matches
// into hpcsa_register. Refresh on a 14-day schedule; between refreshes the
// app verifies individual referrer signups against the table and falls back
// to staff-card OCR on a miss.
//
// Bulk export:
//   Bulk mode sweeps the whole register with letter-prefix surName wildcards
//   (surName="A*" etc.). A single call returns ~10-60k rows (~1-11 MB), so the
//   full ~600k-row register is 26 requests (A-Z). A resume-state file
//   (script/hpcsa_bulk_state.json) records which letters are done, so an
//   interrupted sweep continues where it stopped. Bulk mode does NOT touch
//   the surname checklist — it replaces the table's coverage, while the
//   checklist keeps refreshing specific surnames between bulk sweeps.
//
// Usage:
//   npx tsx script/hpcsa-scrape.ts              # refresh whole checklist
//   npx tsx script/hpcsa-scrape.ts KNAUER DUBE  # refresh just these surnames
//   SKIP_DB=1 npx tsx script/hpcsa-scrape.ts X  # search only, print JSON
//   npx tsx script/hpcsa-scrape.ts --bulk       # sweep A-Z into the table
//   npx tsx script/hpcsa-scrape.ts --bulk C D   # sweep only these letters
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, APP_DB_SECRET (same as the app server).
// The app server (production) imports runHpcsaRefresh from this file and runs
// it every 14 days; it also appends surnames from failed referrer signups so
// the next refresh covers them.

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

export const SEARCH_URL = "https://hpcsaonline.custhelp.com/cc/ReportController/getDataFromRnow";
const DELAY_MS = 2000; // politeness between requests
// The bundle compiles to CJS (no import.meta), so resolve the checklist
// against the project root via process.cwd() — production and dev both run
// from the repo root (see npm scripts).
export const CHECKLIST = process.env.HPCSA_CHECKLIST || path.resolve(process.cwd(), "script", "hpcsa_surnames.txt");
// Resume state for --bulk sweeps: which letters have already been fetched.
const BULK_STATE = process.env.HPCSA_BULK_STATE || path.resolve(process.cwd(), "script", "hpcsa_bulk_state.json");

export interface Row {
  title: string;
  surname: string;
  full_name: string;
  registration_number: string;
  city: string;
  postal_code: string;
  categories: string;
  status: string;
}

function encodeParams(v: Record<string, string>): string {
  return Object.entries(v)
    .map(([k, val]) => `${encodeURIComponent(k)}=${encodeURIComponent(val)}`)
    .join("&");
}

export async function searchIRegister(surname: string, wildcard: boolean): Promise<Row[]> {
  const body = encodeParams({
    regNumber: "",
    firstName: "",
    middleName: "",
    // Prefix wildcard only — iRegister anchors matching at the start of the
    // surname, so "DUBE*" covers DUBE, DUBE-NKOSI, DUBENKOSI, etc. A trailing
    // asterisk (*DUBE*) silently matches nothing.
    surName: wildcard ? `${surname}*` : surname,
    city: "",
    postalCode: "",
    register: "",
    category: "",
  });
  const t0 = Date.now();
  const res = await fetch(SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`iRegister HTTP ${res.status} for ${surname}`);
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`iRegister non-JSON response for ${surname}: ${text.slice(0, 120)}`);
  }
  const rows: Row[] = (json.data || [])
    .map((r: any[]) => ({
      title: String(r[0] ?? ""),
      surname: String(r[1] ?? "").toUpperCase(),
      full_name: String(r[2] ?? "").toUpperCase(),
      registration_number: String(r[3] ?? "").replace(/\s+/g, " ").trim(),
      city: String(r[4] ?? ""),
      postal_code: String(r[5] ?? ""),
      categories: String(r[6] ?? ""),
      status: String(r[7] ?? ""),
    }))
    // Unregistered students have no registration number — they are the
    // exact referrers we must NOT auto-approve, so keep them. Give them a
    // stable synthetic key derived from their name; if two rows still share
    // a key (identical name, or same name different city), disambiguate with
    // an index so the batch upsert never sees a duplicate conflict target.
    .map((r: Row) =>
      r.registration_number
        ? r
        : { ...r, registration_number: `NOREG_${(r.full_name + " " + r.surname).replace(/\s+/g, "_")}` }
    );
  console.log(`  ${surname}${wildcard ? " (wild)" : ""}: ${rows.length} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return rows;
}

function makeClient() {
  const apiKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!process.env.SUPABASE_URL || !apiKey || !process.env.APP_DB_SECRET) {
    throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY / APP_DB_SECRET must be set");
  }
  return createClient(process.env.SUPABASE_URL, apiKey, {
    auth: { persistSession: false },
    global: { headers: { "x-app-secret": process.env.APP_DB_SECRET } },
  });
}

const UPSERT_BATCH = 200; // per-request row cap for batch upserts

function upsertBatch(sb: ReturnType<typeof makeClient>, rows: Row[], now: string) {
  return sb.from("hpcsa_register").upsert(
    rows.map((r) => ({
      surname: r.surname,
      full_name: r.full_name,
      registration_number: r.registration_number,
      hpcsa_number: r.registration_number.startsWith("NOREG_") ? "" : r.registration_number,
      categories: r.categories,
      city: r.city,
      postal_code: r.postal_code,
      status: r.status,
      scraped_at: now,
    })),
    { onConflict: "registration_number" }
  );
}

// Small sets (surname checklist) stay row-by-row so one bad row surfaces
// immediately. Large sweeps (bulk export) go in batches with intra-batch
// deduplication — iRegister legitimately repeats a registration number
// (one practitioner, several categories/cities), and a single ON CONFLICT
// upsert cannot touch the same row twice. Last occurrence wins, matching
// the old row-by-row behavior.
async function upsertRows(rows: Row[]) {
  const sb = makeClient();
  if (rows.length <= UPSERT_BATCH) {
    for (const r of rows) {
      const { error } = await sb.from("hpcsa_register").upsert(
        {
          surname: r.surname,
          full_name: r.full_name,
          registration_number: r.registration_number,
          hpcsa_number: r.registration_number.startsWith("NOREG_") ? "" : r.registration_number,
          categories: r.categories,
          city: r.city,
          postal_code: r.postal_code,
          status: r.status,
          scraped_at: new Date().toISOString(),
        },
        { onConflict: "registration_number" }
      );
      if (error) throw new Error(`upsert ${r.registration_number}: ${error.message}`);
    }
    console.log(`  upserted ${rows.length} rows`);
    return;
  }
  const now = new Date().toISOString();
  const seen = new Map<string, number>(); // registration_number -> last index
  for (let i = 0; i < rows.length; i++) seen.set(rows[i].registration_number, i);
  const deduped: Row[] = [];
  for (let i = 0; i < rows.length; i++) if (seen.get(rows[i].registration_number) === i) deduped.push(rows[i]);
  if (deduped.length < rows.length) console.log(`  deduped ${rows.length} -> ${deduped.length} rows`);
  for (let i = 0; i < deduped.length; i += UPSERT_BATCH) {
    const { error } = await upsertBatch(sb, deduped.slice(i, i + UPSERT_BATCH), now);
    if (error) throw new Error(`upsert batch ${i}/${deduped.length}: ${error.message}`);
  }
  console.log(`  upserted ${deduped.length} rows in ${Math.ceil(deduped.length / UPSERT_BATCH)} batches`);
}

// One wildcard call per letter prefix: surName="A*" returns every
// practitioner whose surname starts with A in a single ~1-11 MB response.
// Letters are processed alphabetically and each is marked done in the state
// file only after its rows are upserted, so Ctrl-C + re-run resumes cleanly.
async function searchWithRetry(pattern: string): Promise<Row[]> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await searchIRegister(pattern, true);
    } catch (e) {
      const wait = attempt * 10000;
      console.log(`  ${pattern}: attempt ${attempt} failed (${e}), retrying in ${wait / 1000}s...`);
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new Error("unreachable");
}

// Fetch + upsert one wildcard pattern (e.g. "M" or "MN"). Returns row count.
async function sweepPattern(pattern: string, skipDb: boolean): Promise<number> {
  const rows = await searchWithRetry(pattern);
  if (!skipDb) await upsertRows(rows);
  await new Promise((r) => setTimeout(r, DELAY_MS));
  return rows.length;
}

// A letter whose whole sweep 500s gets split: L* -> LL*LLL*…LM* -> etc.
// Depth 1 covers any letter up to ~256 sub-requests (999+ at depth 2, which
// no single letter can reach — the register has ~600k rows in total).
async function sweepLetter(l: string, skipDb: boolean, t0: number): Promise<number> {
  try {
    return await sweepPattern(l, skipDb);
  } catch (e) {
    console.log(`  ${l}: whole-letter sweep failed (${e}) — splitting into ${l}*A*${l}*Z*`);
    let total = 0;
    for (const c2 of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
      const sub = l + c2;
      try {
        total += await sweepPattern(sub, skipDb);
      } catch (e2) {
        console.log(`  ${sub}: still failing (${e2}) — splitting one level deeper`);
        let subTotal = 0;
        for (const c3 of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
          subTotal += await sweepPattern(sub + c3, skipDb);
        }
        total += subTotal;
      }
      console.log(`  ${l}: [${sub}] ${total} rows so far (${Date.now() - t0}s)`);
    }
    return total;
  }
}

export async function runBulkExport(letters: string[], skipDb: boolean) {
  const state: { done: string[]; started: string; lastLetter?: string } =
    fs.existsSync(BULK_STATE)
      ? (JSON.parse(fs.readFileSync(BULK_STATE, "utf8")) as { done: string[]; started: string })
      : { done: [], started: new Date().toISOString() };
  const pending = process.argv.includes("--redo")
    ? letters
    : letters.filter((l) => !state.done.includes(l));
  if (!pending.length) {
    console.log(`Nothing to do — letters ${letters.join("")} already in ${BULK_STATE}.`);
    return 0;
  }
  console.log(
    pending.length === letters.length
      ? `Bulk sweep: letters ${letters.join("")} (${pending.length} requests)`
      : `Resuming bulk sweep: ${pending.join("")} (done: ${state.done.join("") || "none"})`
  );
  let total = 0;
  for (const l of pending) {
    const t0 = Date.now();
    // A single request can hit a transient 500 (especially on very large
    // results — e.g. M* reliably returns 500). Retry with backoff; if the
    // letter still fails, fall back to sub-letter splits (MA*, MB*, …)
    // which stay under whatever threshold triggers the 500. Each piece is
    // upserted as it completes, so an interrupted split resumes on re-run.
    total += await sweepLetter(l, skipDb, t0);
    state.done.push(l);
    state.lastLetter = l;
    fs.writeFileSync(BULK_STATE, JSON.stringify(state, null, 2));
    console.log(`  [${state.done.length}/${letters.length}] done through ${l}: ${total} rows, ${(Date.now() - t0) / 1000}s for this letter`);
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }
  console.log(`Bulk export done: ${total} rows from ${pending.length} letter sweeps (total done: ${state.done.length}/${letters.length}).`);
  return total;
}

function loadChecklist(): string[] {
  if (!fs.existsSync(CHECKLIST)) {
    console.error(`Checklist not found: ${CHECKLIST}`);
    process.exit(1);
  }
  return fs
    .readFileSync(CHECKLIST, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim().toUpperCase())
    .filter((l) => l && !l.startsWith("#"));
}

async function run(surnames: string[], skipDb: boolean) {
  let total = 0;
  for (const s of surnames) {
    // Prefix wildcard (surName="DUBE*") matches the stored surname —
    // iRegister uses leading-anchored matching, not free-form *...*.
    const wild = await searchIRegister(s, true);
    total += wild.length;
    if (skipDb) {
      if (wild.length) console.log(JSON.stringify(wild, null, 2));
    } else {
      await upsertRows(wild);
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }
  console.log(`Done: ${total} practitioner rows from ${surnames.length} surname searches.`);
  return total;
}

// Periodic refresh driven by the app server (every 14 days). Searches every
// surname on the checklist — which includes surnames appended when a referrer
// signup could not be verified — and upserts the results.
export async function runHpcsaRefresh() {
  const surnames = loadChecklist();
  return run(surnames, false);
}

export function appendChecklistSurnames(...surnames: string[]) {
  // Preserve comments; upper-case only the surname data lines.
  const raw = fs.existsSync(CHECKLIST) ? fs.readFileSync(CHECKLIST, "utf8").split(/\r?\n/) : [];
  const existing: string[] = [];
  const comments: string[] = [];
  for (const l of raw) {
    if (!l.trim()) continue;
    if (l.trim().startsWith("#")) comments.push(l.trim());
    else existing.push(l.trim().toUpperCase());
  }
  const set = new Set(existing);
  for (const s of surnames) {
    const clean = s.trim().toUpperCase();
    if (clean) set.add(clean);
  }
  fs.writeFileSync(CHECKLIST, [...comments, ...Array.from(set).sort()].join("\n") + "\n");
}

async function main() {
  const args = process.argv.slice(2);
  const skipDb = process.env.SKIP_DB === "1";
  if (args[0] === "--bulk") {
    const letters = (args.slice(1).length ? args.slice(1) : "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""))
      .flatMap((a) => a.toUpperCase().split(""))
      .filter((l) => /[A-Z]/.test(l));
    if (!letters.length) {
      console.error("No letters given for --bulk (e.g. --bulk C D).");
      process.exit(1);
    }
    await runBulkExport(letters, skipDb);
    return;
  }
  const surnames = args.length ? args.map((a) => a.toUpperCase()) : loadChecklist();
  await run(surnames, skipDb);
}

// The web server imports the search helpers from this module. Only run the
// command-line sweep when this file itself is the process entry point.
if (process.argv[1] && /(?:^|[\\/])hpcsa-scrape\.(?:ts|js|cjs|mjs)$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
