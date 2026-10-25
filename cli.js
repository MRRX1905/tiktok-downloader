"use strict";

const UPSTREAM = "https://snaptik.fi/api/tiktok";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function parse(url) {
  const res = await fetch(UPSTREAM, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://snaptik.fi",
      Referer: "https://snaptik.fi/",
      "User-Agent": UA,
    },
    body: JSON.stringify({ url }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

async function download(url, filename) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://www.tiktok.com/" },
  });
  if (!res.ok) throw new Error(`Download gagal (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  require("fs").writeFileSync(filename, buf);
  return { filename, bytes: buf.length };
}

function slug(s) {
  return (
    (s || "tiktok")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 60) || "tiktok"
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("-h") || args.includes("--help")) {
    console.log("Pemakaian:");
    console.log('  node cli.js <url-tiktok>              # tampilkan info + link');
    console.log('  node cli.js <url> -d [mp4|mp3]        # unduh file');
    process.exit(0);
  }

  const url = args[0];
  const wantDl = args.includes("-d");
  const kind = (args[args.indexOf("-d") + 1] || "mp4").toLowerCase();

  console.log("Parsing:", url);
  const d = await parse(url);
  const dl = d.download_link || {};

  console.log("\nTitle   :", d.title || d.description);
  console.log("Author  :", d.author ? `${d.author.nickname} (@${d.author.uniqueId})` : d.artist);
  console.log("Duration:", (d.duration || d.music_duration || 0) + "s");
  if (d.statistics) {
    console.log(
      "Stats   :",
      `${d.statistics.play_count || 0} views, ${d.statistics.digg_count || 0} likes`
    );
  }
  console.log("\nLink tersedia:");
  if (dl.no_watermark) console.log("  MP4 (tanpa watermark):", dl.no_watermark);
  if (dl.hd) console.log("  MP4 HD               :", dl.hd);
  if (dl.watermark) console.log("  MP4 (watermark)      :", dl.watermark);
  if (dl.mp3) console.log("  MP3                  :", dl.mp3);
  if (Array.isArray(dl.images)) console.log("  Images               :", dl.images.length, "file");

  if (!wantDl) return;

  let target, name;
  if (kind === "mp3") {
    if (!dl.mp3) throw new Error("Link MP3 tidak tersedia.");
    target = dl.mp3;
    name = slug(d.title) + ".mp3";
  } else {
    if (!dl.no_watermark && !dl.hd) throw new Error("Link MP4 tidak tersedia.");
    target = dl.no_watermark || dl.hd;
    name = slug(d.title) + ".mp4";
  }

  console.log("\nMengunduh ->", name);
  const out = await download(target, name);
  console.log(`Selesai: ${out.filename} (${(out.bytes / 1024 / 1024).toFixed(2)} MB)`);
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
