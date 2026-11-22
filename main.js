const { app, BrowserWindow, Menu, dialog, ipcMain, protocol } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const scan = require("./main/scanner");
const { createStore } = require("./main/store");
const { createCovers, cached } = require("./main/covers");

const page = path.join(__dirname, "renderer", "index.html");
const dir = app.getPath("userData");
const selected = new Set();
const pending = new Set();
const queue = [];
let workers = 0, completed = 0, total = 0;
let win, store, covers, scanning;
protocol.registerSchemesAsPrivileged([{ scheme: "gamehub-cover", privileges: { standard: true, secure: true } }]);

function string(v, max, empty = false) {
  if (typeof v !== "string" || v.length > max || v.includes("\0") || (!empty && !v.trim())) throw Error("Valor inválido.");
  return v.trim();
}
function idOf(id) {
  if (!/^[\da-f-]{36}$/i.test(string(id, 36))) throw Error("Identificador inválido.");
  return id;
}
function gameById(id, games = store.games()) {
  const game = games.find(g => g.id === idOf(id));
  if (!game) throw Error("Jogo não encontrado na biblioteca.");
  return game;
}
function validExe(exe) {
  string(exe, 32767);
  if (!path.isAbsolute(exe) || !/\.exe$/i.test(exe)) throw Error("Selecione um executável do Windows.");
}
function emit(type, data) {
  if (win && !win.isDestroyed()) win.webContents.send("update", { type, data });
}
function handle(channel, count, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.sender !== win?.webContents || event.senderFrame !== win.webContents.mainFrame ||
        event.senderFrame.url !== pathToFileURL(page).href || args.length !== count) throw Error("Pedido inválido.");
    await store.ready;
    return fn(...args);
  });
}
function publicSettings() {
  const { columns, folders, key, guideSeen } = store.settings();
  return { columns, folders, guideSeen, hasKey: Boolean(key || process.env.STEAMGRIDDB_KEY), version: app.getVersion() };
}
function queueCovers(games, retryCached = false) {
  let count = 0;
  for (const game of games) {
    if (!pending.has(game.id) && (retryCached || !cached.test(game.cover))) {
      pending.add(game.id);
      queue.push(game.id);
      total++; count++;
    }
  }
  while (queue.length && workers < 3) void coverWorker();
  return count;
}
async function coverWorker() {
  workers++;
  while (queue.length) {
    const id = queue.shift();
    try {
      const game = gameById(id);
      emit("covers", { completed, total });
      let cover;
      if (game.cover && !cached.test(game.cover)) cover = await covers.download(game.cover).catch(() => "");
      if (!cover) cover = await covers.search(game.name, [], game.steamId);
      if (cover) {
        await store.gamesChange(list => {
          const item = list.find(g => g.id === id);
          if (item && item.name === game.name && item.cover === game.cover) item.cover = cover;
        });
        emit("library");
      }
    } catch { /* O jogo pode ter sido removido durante a busca. */ }
    pending.delete(id);
    completed++;
    emit("covers", { completed, total });
  }
  if (--workers === 0) completed = total = 0;
}
async function importGames(mode, folder) {
  if (scanning) await scanning;
  if (scanning) return importGames(mode, folder);
  const progress = name => emit("scan", name);
  scanning = (async () => {
    let found = [];
    progress("Procurando jogos");
    if (mode === "stores") {
      const results = await Promise.allSettled([scan.steam(progress), scan.epic(progress), scan.gog(progress)]);
      found = results.flatMap(r => r.status === "fulfilled" ? r.value : []);
    }
    for (const root of folder ? [folder] : store.settings().folders) {
      found.push(...await scan.folder(root, progress));
    }
    const detected = new Map();
    for (const game of found) {
      const key = scan.pathKey(game.exe);
      if (!detected.has(key)) detected.set(key, game);
    }
    const missing = new Map();
    if (mode === "stores") {
      progress("Verificando caminhos dos jogos de loja");
      for (const game of store.games()) {
        if (!["Steam", "Epic", "GOG"].includes(game.source)) continue;
        if (detected.has(scan.pathKey(game.exe))) continue;
        const exists = await fs.stat(game.exe).then(
          info => info.isFile(),
          err => !["ENOENT", "ENOTDIR"].includes(err.code),
        );
        if (!exists) missing.set(game.id, game.exe);
      }
    }
    const result = await store.gamesChange(list => {
      let removed = 0;
      for (let i = list.length - 1; i >= 0; i--) {
        const game = list[i];
        if (missing.get(game.id) === game.exe) {
          list.splice(i, 1);
          removed++;
        }
      }
      const keys = new Set(list.map(game => scan.pathKey(game.exe)));
      let added = 0;
      for (const [key, game] of detected) {
        if (keys.has(key)) continue;
        list.push({ ...game, id: randomUUID(), lastPlayed: 0, cover: "" });
        added++;
      }
      return { added, existing: detected.size - added, removed };
    });
    emit("library");
    queueCovers(store.games().filter(g => !g.cover && detected.has(scan.pathKey(g.exe))));
    return result;
  })();
  try { return await scanning; }
  finally { scanning = null; emit("scan", ""); }
}
async function pick(directory) {
  const options = directory ? { properties: ["openDirectory"] } :
    { properties: ["openFile"], filters: [{ name: "Executáveis", extensions: ["exe"] }] };
  const result = await dialog.showOpenDialog(win, options);
  return result.canceled ? null : result.filePaths[0];
}
function bind() {
  handle("state", 0, () => ({ games: store.games(), settings: publicSettings() }));
  handle("guide-seen", 0, () => store.settingsChange(s => { s.guideSeen = true; }));
  handle("columns", 1, n => {
    if (![1,2,3,4,5].includes(n)) throw Error("Quantidade de colunas inválida.");
    return store.settingsChange(s => { s.columns = n; });
  });
  handle("key", 1, value => {
    const key = string(value, 128, true);
    if (key && !/^[a-z0-9_-]+$/i.test(key)) throw Error("Chave inválida.");
    return store.settingsChange(s => { s.key = key; });
  });
  handle("pick-exe", 0, async () => {
    const exe = await pick(false);
    if (!exe) return null;
    validExe(exe);
    selected.add(scan.pathKey(exe));
    return { exe, name: scan.suggest(exe) };
  });
  handle("save", 1, async input => {
    if (!input || typeof input !== "object") throw Error("Jogo inválido.");
    const id = input.id === null ? randomUUID() : gameById(input.id).id;
    const exe = string(input.exe, 32767);
    validExe(exe);
    const original = input.id && gameById(id);
    const key = scan.pathKey(exe);
    if (original?.exe !== exe && !selected.has(key)) throw Error("Escolha o executável pelo botão Selecionar.");
    const name = string(input.name, 512, true) || scan.suggest(exe);
    let cover = string(input.cover, 4096, true);
    if (cover && !cached.test(cover) && cover !== original?.cover) cover = await covers.download(cover);
    if (cached.test(cover)) await fs.access(path.join(dir, cover));
    await store.gamesChange(list => {
      if (list.some(g => g.id !== id && scan.pathKey(g.exe) === key)) throw Error("Esse executável já está na biblioteca.");
      const fields = { id, exe, name, cover };
      if (original) Object.assign(gameById(id, list), fields);
      else list.push({ ...fields, lastPlayed: 0, source: "manual" });
    });
    emit("library");
  });
  handle("remove", 1, id => store.gamesChange(list => {
    const game = gameById(id, list);
    list.splice(list.indexOf(game), 1);
    return true;
  }));
  handle("launch", 1, async id => {
    const { exe } = gameById(id);
    validExe(exe);
    if (!(await fs.stat(exe).catch(() => null))?.isFile()) return { missing: true };
    await new Promise((resolve, reject) => {
      const child = spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: "ignore" });
      child.once("error", () => reject(Error("O Windows não conseguiu iniciar o jogo.")));
      child.once("spawn", () => { child.unref(); resolve(); });
    });
    await store.gamesChange(list => { const g = list.find(item => item.id === id); if (g) g.lastPlayed = Date.now(); });
    emit("library");
    return { missing: false };
  });
  handle("folder-add", 0, async () => {
    const root = await pick(true);
    if (!root) return null;
    await store.settingsChange(s => {
      if (!s.folders.some(p => scan.pathKey(p) === scan.pathKey(root))) s.folders.push(root);
    });
    return importGames("folder", root);
  });
  handle("folder-remove", 1, root => {
    string(root, 32767);
    if (!store.settings().folders.includes(root)) throw Error("Pasta desconhecida.");
    return store.settingsChange(s => { s.folders = s.folders.filter(f => f !== root); });
  });
  handle("scan", 1, mode => {
    if (!["stores","folders"].includes(mode)) throw Error("Origem inválida.");
    return importGames(mode);
  });
  handle("find-cover", 2, (title, excluded) => {
    if (!Array.isArray(excluded) || excluded.length > 50 || excluded.some(s => typeof s !== "string" || !cached.test(s))) throw Error("Seleção inválida.");
    return covers.search(string(title, 512), excluded);
  });
  handle("missing-covers", 0, async () => {
    const missing = [];
    for (const game of store.games()) {
      if (!cached.test(game.cover) || !(await fs.stat(path.join(dir, game.cover)).catch(() => null))?.isFile()) missing.push(game);
    }
    return queueCovers(missing, true);
  });
}
async function restoreFolderNames() {
  const roots = store.settings().folders.map(folder => ({
    prefix: scan.pathKey(folder) + "\\",
    label: scan.folderLabel(folder),
  })).sort((a, b) => b.prefix.length - a.prefix.length);
  const names = new Map();
  for (const game of store.games()) {
    if (game.source !== "folder" || game.folderName) continue;
    const exe = scan.pathKey(game.exe);
    const root = roots.find(folder => exe.startsWith(folder.prefix));
    if (root) names.set(game.id, root.label);
  }
  if (!names.size) return;
  await store.gamesChange(list => {
    for (const game of list) {
      if (names.has(game.id)) game.folderName = names.get(game.id);
    }
  });
}
async function start() {
  store = createStore(dir);
  covers = createCovers(dir, () => store.settings().key || process.env.STEAMGRIDDB_KEY);
  await store.ready;
  await restoreFolderNames();
  protocol.handle("gamehub-cover", async req => {
    const url = new URL(req.url);
    const relative = url.pathname.slice(1);
    if (url.hostname !== "local" || !cached.test(relative)) return new Response(null, { status: 404 });
    try {
      const bytes = await fs.readFile(path.join(dir, relative));
      const type = path.extname(relative).slice(1);
      return new Response(bytes, { headers: { "Content-Type": "image/" + (type === "jpg" ? "jpeg" : type) } });
    } catch { return new Response(null, { status: 404 }); }
  });
  bind();
  Menu.setApplicationMenu(null);
  const appId = app.isPackaged ? "com.gamehub.app" : "com.gamehub.app.dev";
  if (process.platform === "win32") app.setAppUserModelId(appId);
  win = new BrowserWindow({ icon: path.join(__dirname, "assets", "gamehub-icon.png"), width: 1150, height: 780, minWidth: 640, minHeight: 520,
    backgroundColor: "#101419", webPreferences: { preload: path.join(__dirname, "preload.js"),
    contextIsolation: true, nodeIntegration: false, sandbox: true } });
  if (process.platform === "win32") {
    const appIconPath = app.isPackaged ? process.execPath : path.join(__dirname, "assets", "gamehub-icon.ico");
    const relaunchCommand = '"' + process.execPath + '"';
    const command = app.isPackaged ? relaunchCommand : relaunchCommand + ' "' + __dirname + '"';
    win.setAppDetails({ appId, appIconPath, relaunchCommand: command, relaunchDisplayName: "GameHub" });
  }
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", e => e.preventDefault());
  await win.loadFile(page);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { if (win?.isMinimized()) win.restore(); win?.focus(); });
  app.whenReady().then(start).catch(err => { dialog.showErrorBox("GameHub", "Falha ao abrir a biblioteca. " + err.message); app.quit(); });
  app.on("window-all-closed", () => app.quit());
}
