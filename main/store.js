const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function createStore(dir) {
  let tail = Promise.resolve();
  function run(task) {
    const result = tail.then(task);
    tail = result.catch(() => {});
    return result;
  }
  async function read(name, fallback, valid) {
    const file = path.join(dir, name);
    let raw;
    try { raw = await fs.readFile(file, "utf8"); }
    catch (err) { if (err.code === "ENOENT") return fallback; throw err; }
    try {
      const value = JSON.parse(raw.replace(/^\uFEFF/, ""));
      if (valid(value)) return value;
    } catch {}
    await fs.rename(file, file + "." + randomUUID() + ".bak");
    await write(name, fallback);
    return fallback;
  }
  async function write(name, value) {
    const file = path.join(dir, name);
    const tmp = file + "." + randomUUID() + ".tmp";
    try {
      await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
      await fs.rename(tmp, file);
    } finally { await fs.rm(tmp, { force: true }).catch(() => {}); }
  }
  let games, settings;
  const ready = run(async () => {
    await fs.mkdir(dir, { recursive: true });
    const old = await read("games.json", [], Array.isArray);
    const ids = new Set();
    games = old.filter(g => g && typeof g.exe === "string").map(g => {
      const id = typeof g.id === "string" && /^[\da-f-]{36}$/i.test(g.id) && !ids.has(g.id) ? g.id : randomUUID();
      ids.add(id);
      return { ...g, id, name: typeof g.name === "string" && g.name.trim() ? g.name : path.parse(g.exe).name,
        cover: typeof g.cover === "string" ? g.cover : "",
        source: g.source || "manual", lastPlayed: Number.isFinite(g.lastPlayed) ? g.lastPlayed : 0 };
    });
    if (JSON.stringify(old) !== JSON.stringify(games)) await write("games.json", games);
    const stored = await read("settings.json", {}, v => v && typeof v === "object" && !Array.isArray(v));
    settings = { columns: [1,2,3,4,5].includes(stored.columns) ? stored.columns : 3,
      folders: Array.isArray(stored.folders) ? stored.folders.filter(f => typeof f === "string" && path.isAbsolute(f)) : [],
      guideSeen: stored.guideSeen === true,
      key: typeof stored.key === "string" ? stored.key : "" };
  });
  async function change(kind, edit) {
    return run(async () => {
      await ready;
      const next = structuredClone(kind === "games" ? games : settings);
      const result = edit(next);
      await write(kind + ".json", next);
      if (kind === "games") games = next;
      else settings = next;
      return result;
    });
  }
  return { ready, games: () => games, settings: () => settings,
    gamesChange: edit => change("games", edit), settingsChange: edit => change("settings", edit) };
}
module.exports = { createStore };
