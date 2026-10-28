// 画面を撮る道具の共通部分（ui-check.mjs・ui-variants.mjs が使う）。
// 試しの入口（desktop/examples/serve.rs）を試験のロット（program/tests/fixture_lot.py）で起こし、本物と同じ画面を
// 利用者の PC と同じ大きさ（2160×1440・表示倍率 125% → 1728×1152）で開く。窓だけが答えること（更新・配布・ショートカット）は
// 作り物の答え（FAKE）で返す。
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

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

/** 試しの入口を試験のロットで起こす（more: 足す設備 [{name, path}]。測る道具が大きなロットの束を足す。
    home: 作業場所（渡せば閉じても消さない。アプリを起こし直しても残る物〈覚えた値〉を測るため）） */
// 共有のフィルタの置き場は、作業の場所の shared（閉じると消える）。
// 環境変数 DT_UI_MORE（足す設備 [{name, path}] の JSON）・DT_UI_LOT（撮るときに開くロット。省くと試験のロット）で、本物のロットの束でも撮れる
// （欠陥の多いロットでないと見えない物〈MAP の記号の重なり・フィルタで減る画像〉を撮るため）。
export async function launch(fake = FAKE, more = [], { home } = {}) {
  more = [...more, ...JSON.parse(process.env.DT_UI_MORE || "[]")];
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "dt-ui-"));
  execFileSync("python3", [path.join(REPO, "program/tests/fixture_lot.py"), path.join(work, "fx")]);
  const fx = path.join(work, "fx");
  const cfg = path.join(work, "config.json");
  // DT_UI_CFG: 設定に足す物（JSON。例: 共有のフィルタの置き場 filters_shared_dir・開発者 release_users）
  fs.writeFileSync(cfg, JSON.stringify({ equipments: [{ name: "LS3", path: path.join(fx, "LS3") }, { name: "DL2", path: path.join(fx, "DL2") }, ...more],
    filters_shared_dir: path.join(work, "shared"), ...JSON.parse(process.env.DT_UI_CFG || "{}") }));
  const exe = path.join(REPO, "desktop/target/release/examples/serve");
  if (!fs.existsSync(exe)) execFileSync("cargo", ["build", "--release", "--example", "serve"], { cwd: path.join(REPO, "desktop"), stdio: "inherit" });
  const port = 5600 + Math.floor(Math.random() * 300);
  const proc = spawn(exe, ["--port", String(port), "--config", cfg, "--home", home || path.join(work, "home")],
    { env: { ...process.env, DT_FAKE_DESKTOP: JSON.stringify(fake) }, stdio: "ignore" });
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(url)).ok) break; } catch { /* 起動待ち */ } await new Promise((r) => setTimeout(r, 100)); }
  const browser = await chromium.launch();
  return {
    browser, url, fx, pid: proc.pid,
    async newPage(view) {
      const ctx = await browser.newContext({ viewport: view, deviceScaleFactor: 1.25, locale: "ja-JP" });
      const page = await ctx.newPage();
      await page.addInitScript((lot) => { window.__dtFx = lot; }, process.env.DT_UI_LOT || path.join(fx, "LS3/2026/2026_10/2026_10_25/2026_10_25_22_03_53"));
      // 開くのが 30 秒で終わらないことがまれにある（再現できていない）。待ったままの問い合わせを書き出し、1 度だけ開き直す
      const pend = new Set();
      page.on("request", (r) => pend.add(r)); page.on("requestfinished", (r) => pend.delete(r)); page.on("requestfailed", (r) => pend.delete(r));
      await page.goto(url).catch(async (e) => {
        console.error(`開くのが終わらない（${e.message.split("\n")[0]}）。待ったまま: ${[...pend].map((r) => r.url()).join(" , ") || "なし"}。開き直す`);
        await page.goto(url);
      });
      await page.waitForFunction(() => window.__dtReady === true);
      return page;
    },
    async close() { await browser.close(); proc.kill(); fs.rmSync(work, { recursive: true, force: true }); },
  };
}

/** 起動画面（desktop/splash/index.html。窓が splash.brand などを呼ぶ）を開く。名前と版は窓と同じく brand.json・version.py から */
export async function launchSplash() {
  const brand = JSON.parse(fs.readFileSync(path.join(REPO, "program/app/brand.json"), "utf8"));
  const ver = /APP_VERSION\s*=\s*"([^"]+)"/.exec(fs.readFileSync(path.join(REPO, "program/app/version.py"), "utf8"))[1];
  // アイコン（desktop/splash/icon.png）は窓を作るとき build.rs が描く
  const browser = await chromium.launch();
  return {
    browser,
    async newPage(view) {
      const ctx = await browser.newContext({ viewport: view, deviceScaleFactor: 1.25, locale: "ja-JP" });
      const page = await ctx.newPage();
      await page.goto(pathToFileURL(path.join(REPO, "desktop/splash/index.html")).href);
      await page.evaluate(([n, s, v]) => { window.splash.brand(n, s); window.splash.version(v); }, [brand.name, brand.subtitle, ver]);
      return page;
    },
    async close() { await browser.close(); },
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
  // 縮小画像が全部出るまで（画像の無いロット〈欠陥データだけ〉なら、そう出るまでと MAP が来るまで）
  await page.waitForFunction(() => (document.querySelectorAll("#grid .th img").length > 0 && [...document.querySelectorAll("#grid .th img")].every((i) => i.complete))
    || (!!document.querySelector("#grid .empty") && /件/.test(document.getElementById("mapTitle").textContent)));
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
