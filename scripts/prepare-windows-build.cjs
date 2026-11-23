const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");

if (process.platform !== "win32") process.exit(0);

const version = "winCodeSign-2.6.0";
const checksum = "6LQI2d9BPC3Xs0ZoTQe1o3tPiA28c7+PY69Q9i/pD8lY45psMtHuLwv3vRckiVr3Zx1cbNyLlBR8STwCdcHwtA==";
const defaultCache = path.join(process.env.LOCALAPPDATA, "electron-builder", "Cache");
const cache = path.resolve(process.env.ELECTRON_BUILDER_CACHE || defaultCache, "winCodeSign");
const destination = path.join(cache, version);
const ready = dir => ["rcedit-ia32.exe", "rcedit-x64.exe"].every(file => fs.existsSync(path.join(dir, file)));
const validArchive = file => createHash("sha512").update(fs.readFileSync(file)).digest("base64") === checksum;

function cachedArchive(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".7z")) continue;
    const file = path.join(dir, entry.name);
    if (validArchive(file)) return file;
  }
}

if (!ready(destination)) {
  console.log("Preparando ferramentas de compilação para Windows...");
  fs.mkdirSync(cache, { recursive: true });
  const staging = fs.mkdtempSync(path.join(cache, "gamehub-"));
  try {
    let archive = cachedArchive(cache) || cachedArchive(path.join(defaultCache, "winCodeSign"));
    if (!archive) {
      archive = path.join(staging, version + ".7z");
      const { appBuilderPath } = require("app-builder-bin");
      const url = "https://github.com/electron-userland/electron-builder-binaries/releases/download/" +
        version + "/" + version + ".7z";
      execFileSync(appBuilderPath, ["download", "--url", url, "--output", archive, "--sha512", checksum],
        { stdio: "inherit" });
    }
    const extracted = path.join(staging, "extracted");
    // Os links simbólicos do pacote para macOS são desnecessários no Windows.
    execFileSync(require("7zip-bin").path7za, ["x", archive, "-o" + extracted, "-xr!darwin", "-y"],
      { stdio: ["ignore", "ignore", "inherit"] });
    if (!ready(extracted)) throw new Error("Ferramentas do Windows ausentes no arquivo extraído.");
    try {
      fs.renameSync(extracted, destination);
    } catch (error) {
      if (!ready(destination)) throw error;
    }
  } finally {
    if (path.dirname(fs.realpathSync(staging)) === fs.realpathSync(cache)) {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }
}
