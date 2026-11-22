const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const exec = promisify(execFile);
const clean = s => s.replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
const norm = s => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const pathKey = p => path.win32.normalize(p).toLowerCase().replace(/\\$/, "");
const dependencyFolder = /^[._ -]*(?:(?:common|game|steamworks[ _.-]+common[ _.-]+)?redist(?:ributables?)?|vc[ _.-]*redist|directx|dxredist|dotnet|prereq(?:uisites)?|installer)(?=$|[\d _.-])/i;
const inDependencyFolder = dir => dir.split(/[\\/]+/).some(part => dependencyFolder.test(part));
const maintenance = /^(unins|uninstall|setup|install(?:er)?(?:$|[-_.\d])|vc_?redist|dxsetup|directx|dotnet|unitycrashhandler|crashpad|crashreport|prereq|ue.?prereq|easyanticheat|eosbootstrapper|repair|updater|maintenancetool)/i;
const dependencyExe = /^[._ -]*(?:(?:common[ _.-]*|vc[ _.-]*|dx[ _.-]*)?redist(?:ributables?)?|windowsdesktop-runtime|aspnetcore-runtime|oalinst|xnafx|physx)(?=$|[\d _.-])/i;
const isGameExe = name => /\.exe$/i.test(name) && !maintenance.test(name) && !dependencyExe.test(name);
function suggest(exe) {
  let dir = path.dirname(exe);
  while (/^(bin(?:aries)?|win(?:32|64)|x(?:86|64)|game|release|shipping|retail)$/i.test(path.basename(dir))) dir = path.dirname(dir);
  return clean(path.basename(dir) || path.parse(exe).name);
}
function score(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const pairs = s => Array.from(s.slice(1), (_, i) => s.slice(i, i + 2));
  const counts = new Map();
  for (const p of pairs(a)) counts.set(p, (counts.get(p) || 0) + 1);
  let shared = 0;
  for (const p of pairs(b)) if (counts.get(p)) { shared++; counts.set(p, counts.get(p) - 1); }
  return 2 * shared / Math.max(1, a.length + b.length - 2);
}
async function entries(dir) {
  return fs.readdir(dir, { withFileTypes: true }).catch(() => []);
}
async function mainExe(dir, name) {
  if (inDependencyFolder(dir)) return;
  let best;
  async function visit(folder, depth) {
    for (const entry of await entries(folder)) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory() && depth < 3 && !dependencyFolder.test(entry.name)) await visit(file, depth + 1);
      if (!entry.isFile() || !isGameExe(entry.name)) continue;
      const stat = await fs.stat(file).catch(() => null);
      if (!stat) continue;
      const rank = score(name, path.parse(entry.name).name.replace(/[-_](win64|x64|shipping).*$/i, ""));
      if (!best || rank > best.rank || (rank === best.rank && stat.size > best.size)) best = { file, rank, size: stat.size };
    }
  }
  await visit(dir, 0);
  return best?.file;
}
function folderLabel(dir) {
  return path.win32.basename(dir) || path.win32.parse(dir).root;
}
async function folder(dir, progress) {
  if (inDependencyFolder(dir)) return [];
  const folderName = folderLabel(dir);
  const found = [];
  for (const entry of await entries(dir)) {
    const file = path.join(dir, entry.name);
    progress(entry.name);
    const name = entry.isDirectory() ? clean(entry.name) : path.parse(entry.name).name;
    const exe = entry.isDirectory() ? await mainExe(file, name) :
      entry.isFile() && isGameExe(entry.name) ? file : null;
    if (exe) found.push({ name, exe, source: "folder", folderName });
  }
  return found;
}
async function registry(args) {
  try {
    const { stdout } = await exec("reg.exe", ["query", ...args], { windowsHide: true, timeout: 12000, maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  } catch { return ""; }
}
async function manifests(dir, pattern, parse, progress) {
  const found = [];
  for (const entry of await entries(dir)) {
    if (!entry.isFile() || !pattern.test(entry.name)) continue;
    progress(entry.name);
    try {
      const item = await parse((await fs.readFile(path.join(dir, entry.name), "utf8")).replace(/^\uFEFF/, ""));
      if (item) found.push(item);
    } catch { /* Um manifesto inválido não interrompe a loja. */ }
  }
  return found;
}
async function steam(progress) {
  const reg = await registry(["HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"]);
  const root = reg.match(/SteamPath\s+REG_SZ\s+([^\r\n]+)/i)?.[1].trim() ||
    path.join(process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)", "Steam");
  const roots = new Set([root]);
  const vdf = await fs.readFile(path.join(root, "steamapps/libraryfolders.vdf"), "utf8").catch(() => "");
  for (const m of vdf.matchAll(/"(?:path|\d+)"\s*"([^"]+)"/gi)) {
    const lib = m[1].replace(/\\\\/g, "\\");
    if (path.isAbsolute(lib)) roots.add(lib);
  }
  const games = [];
  for (const lib of roots) {
    const apps = path.join(lib, "steamapps");
    games.push(...await manifests(apps, /^appmanifest_\d+\.acf$/i, async raw => {
      const values = Object.fromEntries(Array.from(raw.matchAll(/"([^"]+)"\s*"([^"]*)"/g), m => [m[1], m[2]]));
      if (!values.installdir || !values.name) return;
      const exe = await mainExe(path.join(apps, "common", values.installdir), values.name);
      if (exe) return { name: values.name, exe, steamId: values.appid, source: "Steam" };
    }, progress));
  }
  return games;
}
function epic(progress) {
  return manifests(path.join(process.env.ProgramData || "C:/ProgramData", "Epic/EpicGamesLauncher/Data/Manifests"), /\.item$/i, async raw => {
    const item = JSON.parse(raw);
    if (!item.DisplayName || !item.InstallLocation || !item.LaunchExecutable) return;
    const exe = path.resolve(item.InstallLocation, item.LaunchExecutable);
    if (isGameExe(path.basename(exe)) && !inDependencyFolder(path.dirname(exe)) && (await fs.stat(exe)).isFile()) return { name: item.DisplayName, exe, source: "Epic" };
  }, progress);
}
async function gog(progress) {
  const reg = await registry(["HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games", "/s"]);
  const found = [];
  for (const block of reg.split(/^HKEY_/m)) {
    const fields = Object.fromEntries(Array.from(block.matchAll(/^\s*(gameName|path|exe)\s+REG_SZ\s+([^\r\n]+)/gmi), m => [m[1].toLowerCase(), m[2].trim()]));
    if (!fields.gamename || !fields.path) continue;
    progress(fields.gamename);
    const candidate = fields.exe && path.resolve(fields.path, fields.exe.replace(/^"|"$/g, ""));
    const valid = candidate && isGameExe(path.basename(candidate)) && !inDependencyFolder(path.dirname(candidate)) && (await fs.stat(candidate).catch(() => null))?.isFile();
    const exe = valid ? candidate : await mainExe(fields.path, fields.gamename);
    if (exe) found.push({ name: fields.gamename, exe, source: "GOG" });
  }
  return found;
}
module.exports = { folder, steam, epic, gog, score, suggest, pathKey, folderLabel };
