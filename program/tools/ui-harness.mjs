// 画面を撮る道具の共通部分（ui-check.mjs・ui-variants.mjs が使う）。
// 試しの入口（desktop/examples/serve.rs）を試験のロット（program/tests/fixture_lot.py）で起こし、本物と同じ画面を
// 利用者の PC と同じ大きさ（2160×1440・表示倍率 125% → 1728×1152）で開く。窓だけが答えること（更新・配布・ショートカット）は
// 作り物の答え（FAKE）で返す。
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
export const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");

/** "1536x864" → {width, height}（省くと 1728×1152） */
export function parseView(s) {
  const m = /^(\d+)x(\d+)$/.exec(s || "");
  return m ? { width: +m[1], height: +m[2] } : { width: 1728, height: 1152 };
}

/** 撮るときの窓の答え（版の知らせ・ショートカット・配布の置き場） */
export const FAKE = {
  info: { installed: true },
  update: { state: "ready", current: "4.0.0", ready: "4.0.1", direction: "up", checkedAt: "2026-10-26 09:12", notes: [], failed: [],
    distributed: { version: "4.0.1", recommended: { note: "画像の読み込みの直し", setBy: "maint" } } },
  install: { installed: true, runningFromApp: true, shortcut: { ask: true, declined: false, links: [], places: ["Desktop", "Programs"] } },
  release: { reachable: true, found: "\\\\server\\share\\90_Releases", folder: "\\\\server\\share\\90_Releases", appFolder: "\\\\server\\share\\90_Releases\\DefectTrace",
    distributed: { version: "4.0.1", setAt: "2026-10-26T08:40:00", setBy: "maint", previous: "4.0.0", recommended: { note: "画像の読み込みの直し", setBy: "maint" } },
    entry: { exists: true, path: "\\\\server\\share\\90_Releases\\DefectTrace\\DefectTrace.exe" },
    versions: [
      { version: "4.0.2", placedAt: "2026-10-26T09:00:00", placedBy: "maint", bytes: 6123456, zip: "DefectTrace-4.0.2-windows.zip" },
      { version: "4.0.1", placedAt: "2026-10-25T17:30:00", placedBy: "maint", bytes: 6100000, zip: "DefectTrace-4.0.1-windows.zip" },
      { version: "4.0.0", placedAt: "2026-10-24T10:00:00", placedBy: "maint", bytes: 6090000, zip: "DefectTrace-4.0.0-windows.zip" }],
    problems: [], me: { canRelease: true, login: "maint", current: "4.0.0" }, checkedAt: "2026-10-26T09:12:00" },
};

/** 試しの入口を試験のロットで起こす */
export async function launch(fake = FAKE) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "dt-ui-"));
  execFileSync("python3", [path.join(REPO, "program/tests/fixture_lot.py"), path.join(work, "fx")]);
  const fx = path.join(work, "fx");
  const cfg = path.join(work, "config.json");
  fs.writeFileSync(cfg, JSON.stringify({ equipments: [{ name: "LS3", path: path.join(fx, "LS3") }, { name: "DL2", path: path.join(fx, "DL2") }] }));
  const exe = path.join(REPO, "desktop/target/release/examples/serve");
  if (!fs.existsSync(exe)) execFileSync("cargo", ["build", "--release", "--example", "serve"], { cwd: path.join(REPO, "desktop"), stdio: "inherit" });
  const port = 5600 + Math.floor(Math.random() * 300);
  const proc = spawn(exe, ["--port", String(port), "--config", cfg, "--home", path.join(work, "home")],
    { env: { ...process.env, DT_FAKE_DESKTOP: JSON.stringify(fake) }, stdio: "ignore" });
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(url)).ok) break; } catch { /* 起動待ち */ } await new Promise((r) => setTimeout(r, 100)); }
  const browser = await chromium.launch();
  return {
    browser, url, fx,
    async newPage(view) {
      const ctx = await browser.newContext({ viewport: view, deviceScaleFactor: 1.25, locale: "ja-JP" });
      const page = await ctx.newPage();
      await page.addInitScript((lot) => { window.__dtFx = lot; }, path.join(fx, "LS3/2026/2026_10/2026_10_25/2026_10_25_22_03_53"));
      await page.goto(url);
      await page.waitForFunction(() => window.__dtReady === true);
      return page;
    },
    async close() { await browser.close(); proc.kill(); fs.rmSync(work, { recursive: true, force: true }); },
  };
}

/** 状態をたどって撮る。each(名前) を状態ごとに呼ぶ */
export const STATE_NAMES = ["start", "lot", "info", "release"];
export async function walk(page, each, states = STATE_NAMES) {
  if (states.includes("start")) await each("start");
  // 前に開いたロット（lastLot）を開き直す画面の仕組みで、22:03 のロットを開く（木もそこまで開く）
  const lot = await page.evaluate(() => window.__dtFx);
  await page.evaluate((p) => localStorage.setItem("lastLot", p), lot);
  await page.reload();
  await page.waitForFunction(() => window.__dtReady === true);
  await page.waitForFunction(() => document.querySelectorAll("#grid .th img").length > 0 && [...document.querySelectorAll("#grid .th img")].every((i) => i.complete));
  await page.waitForTimeout(400);
  if (states.includes("lot")) await each("lot");
  if (states.includes("info")) {
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
    await each("info");
    await page.keyboard.press("Escape");
  }
  if (states.includes("release") && await page.locator("#btnRelease").isVisible()) {
    await page.click("#btnRelease");
    await page.waitForTimeout(500);
    await each("release");
    await page.keyboard.press("Escape");
  }
}

/** 迷いやすさに関わる量（頁の中で動かす） */
export function measure() {
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  let cut = 0, small = 0;
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(el).visibility === "hidden") continue;
    if (r.right > vw + 1) cut = Math.max(cut, Math.round(r.right - vw));
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && fs < 11) small++;
  }
  return { cut, small, hscroll: document.documentElement.scrollWidth > vw, vh };
}
