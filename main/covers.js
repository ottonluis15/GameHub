const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { score } = require("./scanner");
const cached = /^covers\/[a-f0-9]{64}\.(jpg|png|webp)$/;
const bytesLimit = 12 * 1024 * 1024;
function normalizeTitle(value) {
  return value.replace(/[®™©]/g, "").normalize("NFKC").replace(/\b(?:v(?:ersion)?\.?\s*\d+(?:\.\d+)*|\d+(?:\.\d+)+|(?:game of the year|definitive|standard|deluxe|ultimate|complete|special|enhanced|collector.s)?\s*edition)\b/gi, " ").replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
}
function createCovers(dir, getKey) {
  let active = 0;
  const waiting = [];
  // As buscas manuais e automáticas compartilham os três lugares.
  async function request(url, options, read) {
    if (active >= 3) await new Promise(resolve => waiting.push(resolve));
    else active++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      let target = new URL(url);
      for (let hops = 0; hops < 4; hops++) {
        const response = await fetch(target.href, { ...options, redirect: "manual", signal: controller.signal });
        if (response.ok) return await read(response);
        const location = response.headers.get("location");
        if (response.status < 300 || response.status >= 400 || !location) break;
        const next = new URL(location, target);
        if (next.protocol !== "https:" || next.username || next.password || (options?.headers && next.origin !== target.origin)) break;
        await response.body?.cancel();
        target = next;
      }
      throw Error("Não foi possível baixar a imagem ou consultar a loja.");
    } finally {
      controller.abort();
      clearTimeout(timer);
      if (waiting.length) waiting.shift()();
      else active--;
    }
  }
  const json = (url, options) => request(url, options, r => r.json());
  async function download(url) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw Error("Informe uma URL HTTPS.");
    const bytes = await request(url, {}, async r => {
      if (Number(r.headers.get("content-length")) > bytesLimit) throw Error("Capa muito grande.");
      const chunks = [];
      let size = 0;
      for await (const part of r.body) {
        size += part.length;
        if (size > bytesLimit) throw Error("Capa muito grande.");
        chunks.push(part);
      }
      return Buffer.concat(chunks);
    });
    let ext;
    if (bytes.subarray(0,3).equals(Buffer.from([255,216,255]))) ext = "jpg";
    if (bytes.subarray(0,8).equals(Buffer.from("89504e470d0a1a0a","hex"))) ext = "png";
    if (bytes.toString("ascii",0,4) === "RIFF" && bytes.toString("ascii",8,12) === "WEBP") ext = "webp";
    if (!ext) throw Error("Use uma imagem JPEG, PNG ou WebP.");
    const relative = "covers/" + createHash("sha256").update(bytes).digest("hex") + "." + ext;
    const target = path.join(dir, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = target + "." + randomUUID() + ".tmp";
    try {
      await fs.writeFile(tmp, bytes);
      await fs.rename(tmp, target);
    } finally { await fs.rm(tmp, { force: true }).catch(() => {}); }
    return relative;
  }
  async function search(title, excluded = [], steamId) {
    const term = normalizeTitle(title) || title;
    async function tryImages(urls) {
      for (const url of urls) {
        try {
          const local = await download(url);
          if (!excluded.includes(local)) return local;
        } catch {}
      }
    }
    async function steamArt(id) {
      if (!/^\d+$/.test(String(id))) return;
      const root = "https://cdn.akamai.steamstatic.com/steam/apps/" + id + "/";
      return tryImages(["library_600x900.jpg","portrait/capsule_616x353.jpg","capsule_616x353.jpg","header.jpg"].map(f => root + f));
    }
    if (steamId) {
      const cover = await steamArt(steamId);
      if (cover) return cover;
    }
    const rank = list => list.map(item => ({ item, rank: score(term, normalizeTitle(item.name || "")) }))
      .filter(hit => hit.rank >= 0.45).sort((a,b) => b.rank - a.rank).slice(0,3).map(hit => hit.item);
    try {
      const result = await json("https://store.steampowered.com/api/storesearch/?l=portuguese&cc=br&term=" + encodeURIComponent(term));
      for (const item of rank(result.items || [])) {
        if (String(item.id) === String(steamId)) continue;
        const cover = await steamArt(item.id);
        if (cover) return cover;
      }
    } catch {}
    const key = getKey();
    if (key) {
      const options = { headers: { Authorization: "Bearer " + key } };
      try {
        const root = "https://www.steamgriddb.com/api/v2/";
        const hits = await json(root + "search/autocomplete/" + encodeURIComponent(term), options);
        for (const hit of rank(hits.data || [])) {
          const grids = await json(root + "grids/game/" + Number(hit.id) + "?dimensions=600x900", options);
          const cover = await tryImages((grids.data || []).slice(0,8).map(g => g.url));
          if (cover) return cover;
        }
      } catch {}
    }
    return "";
  }
  return { search, download };
}
module.exports = { createCovers, cached };
