(() => {
"use strict";
const $ = id => document.getElementById(id);
const api = window.api;
const gameName = $("gameName"), gameCover = $("gameCover"), gameExe = $("gameExe");
const placeholder = "../assets/default-cover.svg";
const sources = { manual: "Manual", folder: "Pasta", Steam: "Steam", Epic: "Epic Games", GOG: "GOG" };
const normalize = text => text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR");
let games = [], settings = {}, query = "", editing = false;
let current = null, exe = "", suggestion = "", chosen = "", candidate = "", history = [];
let epoch = 0, searchTimer, stateVersion = 0, scanText = "", coverText = "";
function node(tag, text) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  return el;
}
function guarded(fn) {
  return async event => {
    try { await fn(event); }
    catch (err) { toast(String(err.message || err).replace(/^.*?Error:\s*(?:Error:\s*)?/, "")); }
  };
}
function action(id, fn) { $(id).addEventListener("click", guarded(fn)); }
function toast(text, actions = []) {
  const box = node("div", text);
  box.className = "toast";
  for (const [label, fn] of actions) {
    const button = node("button", label);
    button.onclick = guarded(async () => { box.remove(); await fn(); });
    box.append(button);
  }
  (document.querySelector("dialog[open]") || document.body).append($("toasts"));
  $("toasts").append(box);
  setTimeout(() => box.remove(), actions.length ? 18000 : 5000);
}
function coverURL(value) {
  if (/^covers\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(value)) return "gamehub-cover://local/" + value;
  try { const url = new URL(value); if (url.protocol === "https:") return url.href; } catch {}
  return placeholder;
}
function image(img, value) {
  img.onerror = () => { img.onerror = null; img.src = placeholder; };
  img.src = coverURL(value);
}
function render() {
  const source = $("source").value, mode = $("sort").value;
  const list = games.filter(g => (!source || g.source === source) && normalize(g.name).includes(query));
  list.sort((a,b) => mode === "last" ? b.lastPlayed - a.lastPlayed :
    (mode === "za" ? -1 : 1) * a.name.localeCompare(b.name, "pt-BR", { numeric: true }));
  const fragment = document.createDocumentFragment();
  for (const g of list) {
    const card = node("button"), art = node("span"), img = node("img"), caption = node("span");
    card.className = "card"; art.className = "art"; caption.className = "caption";
    card.title = (editing ? "Editar " : "Jogar ") + g.name;
    card.setAttribute("aria-label", card.title);
    img.alt = ""; img.loading = "lazy";
    image(img, g.cover);
    art.append(img);
    const sourceLabel = g.source === "folder" && g.folderName ? g.folderName : sources[g.source] || "Manual";
    const detail = node("small", editing ? "Editar jogo" : sourceLabel);
    if (!editing) {
      detail.className = "source-label";
      detail.title = sourceLabel;
    }
    if (editing) {
      detail.className = "edit-label";
      detail.prepend($("edit").querySelector("svg").cloneNode(true));
    }
    caption.append(node("strong", g.name), detail);
    card.append(art, caption);
    card.onclick = guarded(async () => {
      if (editing) return openEditor(g);
      card.disabled = true;
      try {
        if ((await api.launch(g.id)).missing) toast("Executável não encontrado. Confira se o disco está conectado.", [
          ["Relocalizar", async () => { openEditor(g); await chooseExe(); }],
          ["Remover", () => remove(g)] ]);
      } finally { card.disabled = false; }
    });
    fragment.append(card);
  }
  $("grid").replaceChildren(fragment);
  $("grid").dataset.columns = settings.columns || 3;
  $("count").textContent = list.length + (list.length === 1 ? " jogo" : " jogos") + (editing ? " · Selecione um jogo para editar" : "");
  $("empty").hidden = Boolean(list.length);
  $("emptyTitle").textContent = games.length ? "Nenhum jogo encontrado" : "Sua biblioteca começa aqui";
  $("emptyText").textContent = games.length ? "Experimente outro nome ou escolha outra origem." : "Adicione um executável ou importe os jogos instalados no seu PC.";
  $("emptyAction").textContent = games.length ? "Limpar filtros" : "Adicionar primeiro jogo";
}
async function refresh() {
  const version = ++stateVersion;
  const state = await api.state();
  if (version !== stateVersion) return;
  games = state.games; settings = state.settings;
  $("version").textContent = "GameHub · versão " + settings.version;
  for (const b of $("columns").children) b.setAttribute("aria-pressed", Number(b.textContent) === settings.columns);
  render();
}
function show(id) {
  for (const d of document.querySelectorAll("dialog[open]")) d.close();
  $(id).showModal();
  $("menu").setAttribute("aria-expanded", String(id === "drawer"));
}
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("click", e => {
    const r = dialog.getBoundingClientRect();
    if (e.target === dialog && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) dialog.close();
  });
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    if (dialog.contains($("toasts"))) document.body.append($("toasts"));
    if (dialog.id === "drawer") $("menu").setAttribute("aria-expanded", "false");
    if (dialog.id === "editor") resetEditor();
    if (dialog.id === "settings") $("key").value = "";
  });
}
for (const b of document.querySelectorAll("[data-close]")) b.onclick = () => b.closest("dialog").close();
function invalidate() {
  epoch++; candidate = ""; history = [];
  $("accept").hidden = true; $("find").disabled = false;
  $("find").classList.remove("busy"); $("find").textContent = "Buscar capa";
}
function resetEditor() {
  invalidate(); current = null; exe = suggestion = chosen = "";
  $("gameForm").reset(); $("save").disabled = false;
  gameExe.textContent = ""; gameName.placeholder = "Nome da pasta";
  image($("preview"), "");
}
function openEditor(game = null) {
  resetEditor(); current = game;
  $("editorTitle").textContent = game ? "Editar jogo" : "Adicionar jogo";
  $("delete").hidden = !game;
  if (game) {
    exe = game.exe; chosen = game.cover; suggestion = game.name;
    gameName.value = game.name; gameExe.textContent = exe;
    gameCover.value = /^https:/.test(chosen) ? chosen : "";
    image($("preview"), chosen);
  }
  show("editor");
}
async function chooseExe() {
  const item = await api.pickExe();
  if (!item || !$("editor").open) return;
  invalidate(); exe = item.exe; suggestion = item.name;
  gameExe.textContent = exe; gameName.placeholder = suggestion;
  image($("preview"), chosen);
}
async function remove(game) {
  await api.remove(game.id);
  if ($("editor").open) $("editor").close();
  await refresh(); toast("Jogo removido da biblioteca.");
}
action("pick", chooseExe);
action("delete", () => remove(current));
action("add", () => openEditor());
action("menuAdd", () => openEditor());
action("find", async () => {
  const term = gameName.value.trim() || suggestion;
  if (!term) return toast("Digite o nome do jogo ou escolha um executável.");
  const token = ++epoch, b = $("find");
  b.disabled = true; b.classList.add("busy");
  try {
    const result = await api.findCover(term, history);
    if (token !== epoch) return;
    if (!result) return toast("Nenhuma outra capa encontrada. Confira a conexão ou cole uma URL.");
    candidate = result; history.push(result); image($("preview"), result);
    $("accept").hidden = false; b.textContent = "Tentar outra";
  } finally { if (token === epoch) { b.disabled = false; b.classList.remove("busy"); } }
});
action("accept", () => {
  chosen = candidate; candidate = ""; gameCover.value = "";
  $("accept").hidden = true; toast("Capa selecionada. Salve o jogo para aplicar.");
});
gameName.oninput = () => { invalidate(); image($("preview"), gameCover.value || chosen); };
gameCover.oninput = () => { invalidate(); chosen = gameCover.value.trim(); image($("preview"), chosen); };
$("gameForm").onsubmit = guarded(async event => {
  event.preventDefault();
  if (!exe) return toast("Selecione o executável do jogo.");
  if (candidate) return toast("Clique em Usar esta capa ou informe outra URL.");
  const token = epoch;
  $("save").disabled = true;
  try {
    await api.save({ id: current?.id || null, exe, name: gameName.value, cover: chosen });
    if (token === epoch && $("editor").open) $("editor").close();
    await refresh(); toast("Jogo salvo na biblioteca.");
  } finally { $("save").disabled = false; }
});
function setSearch(value) {
  $("search").value = $("fixedSearch").value = value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { query = normalize(value.trim()); render(); },150);
}
for (const id of ["search","fixedSearch"]) $(id).oninput = e => setSearch(e.target.value);
$("source").onchange = $("sort").onchange = render;
action("emptyAction", () => { if (!games.length) return openEditor(); $("source").value = ""; setSearch(""); });
function scrollState() {
  const visible = window.scrollY > 300;
  document.body.classList.toggle("scrolled", visible);
  $("compact").inert = $("up").inert = !visible;
}
window.addEventListener("scroll", scrollState, { passive: true });
action("up", () => window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion:reduce)").matches ? "instant" : "smooth" }));
action("menu", () => show("drawer"));
action("openGuide", () => show("guide"));
action("edit", () => {
  editing = !editing; $("edit").setAttribute("aria-pressed", editing);
  $("drawer").close(); render();
});
for (let n = 1; n <= 5; n++) {
  const b = node("button", String(n));
  b.onclick = guarded(async () => { await api.columns(n); await refresh(); });
  $("columns").append(b);
}
function folderList() {
  const ul = $("folderList");
  ul.replaceChildren();
  if (!settings.folders.length) ul.append(node("li", "Nenhuma pasta monitorada."));
  for (const folder of settings.folders) {
    const li = node("li"), b = node("button", "Remover");
    b.onclick = guarded(async () => { await api.removeFolder(folder); await refresh(); folderList(); });
    li.append(node("span",folder),b); ul.append(li);
  }
}
action("manage", () => { folderList(); show("folders"); });
async function importing(fn, closeDialogs = true) {
  if (closeDialogs) {
    for (const d of document.querySelectorAll("dialog[open]")) d.close();
  }
  const result = await fn();
  if (!result) return;
  await refresh();
  const removed = result.removed ? " Jogos sem executável removidos: " + result.removed + "." : "";
  toast(result.added + " jogo(s) adicionado(s), " + result.existing + " já existia(m)." + removed);
}
action("stores", () => importing(() => api.scan("stores")));
action("addFolder", () => importing(api.addFolder));
action("rescan", () => importing(() => api.scan("folders")));
action("missing", async () => {
  $("drawer").close();
  const count = await api.missingCovers();
  toast(count ? count + " jogo(s) na fila de capas." : "Nenhuma capa pendente para adicionar à fila.");
});
action("config", () => {
  $("keyStatus").textContent = settings.hasKey ? "Chave configurada. Salvar em branco remove a chave local." : "Sem chave. A busca na Steam está disponível.";
  show("settings");
});
$("keyForm").onsubmit = guarded(async e => {
  e.preventDefault(); await api.key($("key").value.trim()); $("settings").close();
  await refresh(); toast("Configurações salvas.");
});
api.onUpdate(guarded(async ({ type, data }) => {
  if (type === "library") return refresh();
  if (type === "scan") scanText = data ? "Importando · " + data : "";
  if (type === "covers") coverText = data.completed < data.total ? "Buscando capas · " + data.completed + "/" + data.total : "";
  $("workText").textContent = [scanText,coverText].filter(Boolean).join(" · ");
  $("work").hidden = !scanText && !coverText;
}));
guarded(async () => {
  await refresh(); scrollState();
  if (settings.guideSeen === false) {
    show("guide");
    await guarded(() => api.markGuideSeen())();
  }
  if (settings.folders.length) await importing(() => api.scan("folders"), false);
})();
})();
