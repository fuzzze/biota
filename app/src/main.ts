import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "./styles.css";

import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

import { loadTemplates } from "./biota/templates";
import { planEncode, paintGrid, type Tile } from "./biota/render";
import { decodeImage, type TemplateSet } from "./biota/decode";
import type { AspectKind } from "./biota/layout";
import type { RGBA } from "./biota/imaging";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

// Same codebase runs as a Tauri desktop app and as a static web app.
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function browserDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const EYE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.2A10.9 10.9 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-3 3.9M6.6 6.6A18.6 18.6 0 0 0 2 11s3.5 7 10 7a10.8 10.8 0 0 0 4.2-.8"/><path d="m9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M2 2l20 20"/></svg>`;

// ---------- shared state ----------
let templateImages: HTMLImageElement[] = [];
let templateSet: TemplateSet = [];
let currentAspect: AspectKind = "square";
let lastBlob: Blob | null = null;
let previewUrl: string | null = null;
let decodeFile: File | null = null;
let thumbUrl: string | null = null;

// ---------- helpers ----------
function setStatus(el: HTMLElement, text: string, kind: "" | "ok" | "error" = "") {
  el.textContent = text;
  el.className = "status" + (kind ? ` is-${kind}` : "");
}
function busy(btn: HTMLButtonElement, on: boolean, label: string) {
  btn.disabled = on;
  btn.textContent = label;
}

function attachEye(input: HTMLInputElement, btn: HTMLButtonElement) {
  const render = () => { btn.innerHTML = input.type === "password" ? EYE : EYE_OFF; };
  render();
  btn.addEventListener("click", () => {
    input.type = input.type === "password" ? "text" : "password";
    render();
    input.focus();
  });
}

function imageToRGBA(img: HTMLImageElement): RGBA {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, c.width, c.height);
  return { data: id.data, width: id.width, height: id.height };
}

function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("не удалось открыть изображение")); };
    img.src = url;
  });
}

// ---------- tabs ----------
function initTabs() {
  const tabs = document.querySelectorAll<HTMLButtonElement>(".tab");
  tabs.forEach((tab) => tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.toggle("is-active", t === tab));
    const target = tab.dataset.tab;
    $("panel-encrypt").classList.toggle("is-active", target === "encrypt");
    $("panel-decrypt").classList.toggle("is-active", target === "decrypt");
  }));
}

// ---------- encrypt ----------
const encText = $<HTMLTextAreaElement>("enc-text");
const encSecret = $<HTMLInputElement>("enc-secret");
const encStatus = $("enc-status");
const previewImg = $<HTMLImageElement>("preview-img");
const previewEmpty = $("preview-empty");
const encDims = $("enc-dims");
const btnEncode = $<HTMLButtonElement>("btn-encode");
const btnSave = $<HTMLButtonElement>("btn-save");

function initAspect() {
  const segs = document.querySelectorAll<HTMLButtonElement>(".seg");
  segs.forEach((seg) => seg.addEventListener("click", () => {
    segs.forEach((s) => s.classList.toggle("is-active", s === seg));
    currentAspect = seg.dataset.aspect as AspectKind;
    if (encText.value.trim() && lastBlob) void doEncode();
  }));
}

async function doEncode() {
  const text = encText.value;
  if (!text) { setStatus(encStatus, "Введите сообщение", "error"); return; }
  busy(btnEncode, true, "Кодирование…");
  await nextFrame();
  try {
    const { digits, cols, layout } = planEncode(text, encSecret.value, currentAspect);
    const canvas = document.createElement("canvas");
    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext("2d")!;
    const tiles: Tile[] = templateImages.map((img) => ({ img, w: img.naturalWidth, h: img.naturalHeight }));
    paintGrid(ctx, layout, digits, tiles);
    const blob = await new Promise<Blob>((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"));
    lastBlob = blob;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(blob);
    previewImg.src = previewUrl;
    previewImg.style.display = "block";
    previewEmpty.style.display = "none";
    encDims.textContent = `${layout.width}×${layout.height} px · ${cols}×${layout.rows} тайлов`;
    btnSave.disabled = false;
    setStatus(encStatus, "");
  } catch (e) {
    setStatus(encStatus, "Ошибка кодирования: " + String((e as Error).message || e), "error");
  } finally {
    busy(btnEncode, false, "Закодировать");
  }
}

function doClear() {
  encText.value = "";
  encSecret.value = "";
  lastBlob = null;
  btnSave.disabled = true;
  previewImg.style.display = "none";
  previewImg.removeAttribute("src");
  previewEmpty.style.display = "";
  encDims.textContent = "";
  setStatus(encStatus, "");
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  encText.focus();
}

async function doSave() {
  if (!lastBlob) return;
  try {
    if (isTauri) {
      const path = await save({ defaultPath: "biota.png", filters: [{ name: "PNG", extensions: ["png"] }] });
      if (!path) return;
      const bytes = new Uint8Array(await lastBlob.arrayBuffer());
      await invoke("save_file", { path, data: Array.from(bytes) });
      setStatus(encStatus, "Сохранено: " + path, "ok");
    } else {
      browserDownload(lastBlob, "biota.png");
      setStatus(encStatus, "Файл скачан: biota.png", "ok");
    }
  } catch (e) {
    setStatus(encStatus, "Не удалось сохранить: " + String((e as Error).message || e), "error");
  }
}

// ---------- decrypt ----------
const decSecret = $<HTMLInputElement>("dec-secret");
const decOutput = $<HTMLTextAreaElement>("dec-output");
const decStatus = $("dec-status");
const btnDecode = $<HTMLButtonElement>("btn-decode");
const dropzone = $("dropzone");
const decFile = $<HTMLInputElement>("dec-file");
const dropThumb = $<HTMLImageElement>("drop-thumb");
const dropTitle = document.querySelector<HTMLElement>(".drop-title")!;

function setDecodeFile(file: File | null) {
  decodeFile = file;
  if (thumbUrl) { URL.revokeObjectURL(thumbUrl); thumbUrl = null; }
  if (file) {
    thumbUrl = URL.createObjectURL(file);
    dropThumb.src = thumbUrl;
    dropThumb.style.display = "block";
    dropTitle.textContent = file.name;
    setStatus(decStatus, "");
  } else {
    dropThumb.style.display = "none";
    dropThumb.removeAttribute("src");
    dropTitle.textContent = "Перетащите PNG сюда";
  }
}

function initDropzone() {
  dropzone.addEventListener("click", () => decFile.click());
  decFile.addEventListener("change", () => setDecodeFile(decFile.files?.[0] ?? null));
  ["dragenter", "dragover"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("is-drag"); }));
  ["dragleave", "dragend", "drop"].forEach((ev) =>
    dropzone.addEventListener(ev, () => dropzone.classList.remove("is-drag")));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    const f = (e as DragEvent).dataTransfer?.files?.[0];
    if (f) setDecodeFile(f);
  });
}

async function doDecode() {
  if (!decodeFile) { setStatus(decStatus, "Выберите изображение", "error"); return; }
  decOutput.value = "";
  busy(btnDecode, true, "Расшифровка…");
  await nextFrame();
  try {
    const img = await fileToImage(decodeFile);
    const rgba = imageToRGBA(img);
    const res = decodeImage(rgba, templateSet, decSecret.value);
    if (res.ok) {
      decOutput.value = res.text;
      setStatus(decStatus, `Готово · сетка ${res.info.C}×${res.info.R}, исправлено ошибок: ${res.errsCorrected}`, "ok");
    } else if (res.stage === "wrong-secret") {
      setStatus(decStatus, "Неверный пароль или повреждённые данные", "error");
    } else {
      setStatus(decStatus, "Не удалось декодировать: " + (res.message ?? "слишком много ошибок"), "error");
    }
  } catch (e) {
    setStatus(decStatus, "Ошибка: " + String((e as Error).message || e), "error");
  } finally {
    busy(btnDecode, false, "Расшифровать");
  }
}

// ---------- boot ----------
async function main() {
  initTabs();
  initAspect();
  initDropzone();
  attachEye(encSecret, $<HTMLButtonElement>("enc-eye"));
  attachEye(decSecret, $<HTMLButtonElement>("dec-eye"));
  btnEncode.addEventListener("click", () => void doEncode());
  $("btn-clear").addEventListener("click", doClear);
  btnSave.addEventListener("click", () => void doSave());
  btnDecode.addEventListener("click", () => void doDecode());

  try {
    const { images, set } = await loadTemplates();
    templateImages = images;
    templateSet = set;
    $("loading").classList.add("is-hidden");
  } catch (e) {
    $("loading").textContent = "Не удалось загрузить тайлы: " + String((e as Error).message || e);
  }
}

void main();
