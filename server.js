"use strict";

const express = require("express");
const path = require("path");

const PORT = process.env.PORT || 3000;
const UPSTREAM = "https://snaptik.fi/api/tiktok";
const UPSTREAM_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const ALLOWED_HOSTS = [
  "snaptik.fit",
  "snaptik.fi",
  "snaptikapp.com",
  "tiktokcdn.com",
  "tiktokcdn-eu.com",
  "tiktokv.com",
  "tiktokv.eu",
  "byteoversea.com",
  "ibyteimg.com",
  "musical.ly",
  "ttlivecdn.com",
  "moegirl.org.cn",
];

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));

function hostAllowed(hostname) {
  const host = String(hostname || "").toLowerCase();
  return ALLOWED_HOSTS.some(
    (h) => host === h || host.endsWith("." + h)
  );
}

function isTikTokUrl(value) {
  try {
    const u = new URL(String(value).trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return /(^|\.)tiktok\.com$|(^|\.)vm\.tiktok\.com$|(^|\.)vt\.tiktok\.com$|(^|\.)tiktokv\.com$|(^|\.)douyin\.com$|(^|\.)iesdouyin\.com$/.test(
      u.hostname
    );
  } catch {
    return false;
  }
}

app.post("/api/parse", async (req, res) => {
  const url = String((req.body && req.body.url) || "").trim();
  if (!url) {
    return res.status(400).json({ error: "URL kosong." });
  }
  if (!isTikTokUrl(url)) {
    return res
      .status(400)
      .json({ error: "Bukan URL TikTok/Douyin yang valid." });
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);

    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://snaptik.fi",
        Referer: "https://snaptik.fi/",
        "User-Agent": UPSTREAM_UA,
        Accept: "application/json",
      },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const text = await upstream.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res
        .status(502)
        .json({ error: "Respons upstream bukan JSON." });
    }

    if (!upstream.ok || data.error) {
      return res.status(upstream.ok ? 502 : upstream.status).json({
        error: data.error || `Upstream error (HTTP ${upstream.status}).`,
      });
    }

    return res.json(normalize(data));
  } catch (err) {
    const msg =
      err && err.name === "AbortError"
        ? "Timeout: snaptik.fi tidak merespons."
        : "Gagal menghubungi snaptik.fi.";
    return res.status(502).json({ error: msg });
  }
});

app.get("/api/file", async (req, res) => {
  const target = String(req.query.url || "");
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return res.status(400).json({ error: "URL tidak valid." });
  }
  if (!hostAllowed(parsed.hostname)) {
    return res.status(403).json({ error: "Host tidak diizinkan." });
  }

  const filename = String(req.query.name || "").replace(/[^\w.\- ]+/g, "_").slice(0, 120);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);

    const upstream = await fetch(target, {
      headers: {
        "User-Agent": UPSTREAM_UA,
        Referer: "https://www.tiktok.com/",
        Accept: "*/*",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!upstream.ok || !upstream.body) {
      return res
        .status(502)
        .json({ error: `Gagal mengunduh (HTTP ${upstream.status}).` });
    }

    const ct = upstream.headers.get("content-type") || "application/octet-stream";
    const disposition = upstream.headers.get("content-disposition") || "";
    const length = upstream.headers.get("content-length");

    const cdMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i) ||
      disposition.match(/filename="?([^";]+)"?/i);
    const finalName =
      filename ||
      (cdMatch ? decodeURIComponent(cdMatch[1]).trim() : "tiktok_download");

    res.setHeader("Content-Type", ct);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${finalName.replace(/"/g, "")}"`
    );
    res.setHeader("Cache-Control", "no-store");
    if (length) res.setHeader("Content-Length", length);

    const { Readable } = require("stream");
    const nodeStream = Readable.fromWeb(upstream.body);
    nodeStream.on("error", () => res.destroy());
    nodeStream.pipe(res);
  } catch (err) {
    if (!res.headersSent) {
      const msg =
        err && err.name === "AbortError"
          ? "Timeout saat mengunduh."
          : "Gagal mengunduh file.";
      return res.status(502).json({ error: msg });
    }
    res.destroy();
  }
});

function normalize(raw) {
  const dl = raw.download_link || {};
  const author = raw.author || {};
  const images =
    (Array.isArray(raw.images) && raw.images) ||
    (Array.isArray(dl.images) && dl.images) ||
    [];

  return {
    status: raw.status || "ok",
    type: images.length ? "slideshow" : "video",
    title: raw.title || raw.description || "",
    description: raw.description || "",
    duration: raw.duration || raw.music_duration || 0,
    cover: raw.cover || raw.dynamic_cover || "",
    dynamic_cover: raw.dynamic_cover || "",
    audio: raw.audio || "",
    artist: raw.artist || author.nickname || "",
    author: {
      nickname: author.nickname || raw.artist || "",
      uniqueId: author.uniqueId || "",
      signature: author.signature || "",
      avatar: author.avatarThumb || author.avatar || "",
    },
    statistics: {
      play: raw.statistics && raw.statistics.play_count,
      like: raw.statistics && raw.statistics.digg_count,
      comment: raw.statistics && raw.statistics.comment_count,
      share: raw.statistics && raw.statistics.share_count,
    },
    links: {
      no_watermark: dl.no_watermark || dl.hd || "",
      hd: dl.hd || "",
      watermark: dl.watermark || "",
      mp3: dl.mp3 || raw.audio || "",
    },
    images,
  };
}

app.listen(PORT, () => {
  console.log(`Snaptik downloader berjalan di http://localhost:${PORT}`);
});
