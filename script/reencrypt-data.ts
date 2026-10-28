// Re-encrypts clinical images and staff cards that still use the legacy
// APP_DB_SECRET-derived key with the APP_DATA_KEY-derived key ("v2:" IVs).
// Needs the same environment as the server plus APP_DATA_KEY. Safe to re-run:
// rows that are already v2 are skipped. Use --dry-run to count without writing.
//   npx tsx script/reencrypt-data.ts [--dry-run]      (source checkout)
//   node dist/reencrypt-data.cjs [--dry-run]          (deployed release)
import "dotenv/config";

type Columns = { cipher: string; iv: string; tag: string };

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (!process.env.APP_DATA_KEY) throw new Error("Set APP_DATA_KEY (and keep a backup of it) before re-encrypting.");
  const { sb, dataKeys, sealBytes, openBytes } = await import("../server/db");

  async function migrate(table: "referral_images" | "users", columns: Columns, keys: typeof dataKeys.image) {
    let done = 0, lastId = 0;
    for (;;) {
      const { data, error } = await sb.from(table).select(`id,${columns.cipher},${columns.iv},${columns.tag}`)
        .not(columns.cipher, "is", null).not(columns.iv, "like", "v2:%").gt("id", lastId).order("id").limit(100);
      if (error) throw new Error(error.message);
      if (!data?.length) return done;
      for (const row of data as any[]) {
        lastId = row.id;
        const sealed = sealBytes(openBytes({ cipher: row[columns.cipher], iv: row[columns.iv], tag: row[columns.tag] }, keys), keys);
        if (!dryRun) {
          const r = await sb.from(table).update({ [columns.cipher]: sealed.cipher, [columns.iv]: sealed.iv, [columns.tag]: sealed.tag }).eq("id", row.id).eq(columns.iv, row[columns.iv]);
          if (r.error) throw new Error(r.error.message);
        }
        done++;
      }
    }
  }

  const images = await migrate("referral_images", { cipher: "cipher", iv: "iv", tag: "tag" }, dataKeys.image);
  const cards = await migrate("users", { cipher: "card_cipher", iv: "card_iv", tag: "card_tag" }, dataKeys.card);
  console.log(`${dryRun ? "Would re-encrypt" : "Re-encrypted"} ${images} image(s) and ${cards} staff card(s).`);
}

main().catch(error => { console.error(error?.message || error); process.exit(1); });
