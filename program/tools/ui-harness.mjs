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
// 環境変数 DT_UI_MORE（足す設備 [{name, path}] の JSON）・DT_UI_LOT（撮るときに開くロット。省くと試験のロット。試験のロットの中の場所〈DL2/… など〉でもよい）で、本物のロットの束でも撮れる
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
  seedPresence(path.join(work, "shared", "presence"));
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
      await page.addInitScript((lot) => { window.__dtFx = lot; }, path.resolve(fx, process.env.DT_UI_LOT || "LS3/2026/2026_10/2026_10_25/2026_10_25_22_03_53"));
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

/** 使用状況の見本: 6 台の PC（要更新 2・開発者 1・使っていない PC を含む）の記録を置く（形は desktop/src/presence.rs）。
    「いま」の印は撮る間だけ使用中に見えるよう、今の時刻で書く */
function seedPresence(dir) {
  const pad = (n) => String(n).padStart(2, "0");
  const ts = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const now = Date.now(), at = (minAgo) => ts(new Date(now - minAgo * 60000));
  const PCS = [["検査PC-03", "tanaka", "4.5.0", 2880, false], ["仕上PC-11", "suzuki", "4.5.0", 0, false], ["開発PC", "maint", "4.7.0", 0, true],
    ["検査PC-01", "ito", "4.6.0", 0, false], ["事務PC-02", "kato", "4.6.0", 180, false], ["検査PC-05", "yamada", "4.6.0", 7200, false]];
  const w = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v)); };
  PCS.forEach(([pc, login, version, minAgo, developer], i) => {
    const key = `${pc}@${login}`, last = at(minAgo);
    if (!minAgo) w(path.join(dir, "now", key + ".json"), { key, login, pc, version, developer, since: at(40), at: last, left: false });
    w(path.join(dir, "history", key + ".json"), { key, login, pc, firstAt: at(60 * 24 * 20), lastAt: last, sessions: 5 + i * 4, totalSec: 3600 * (2 + i * 5), version, versions: { [version]: last }, developer });
    const ss = [...Array(6)].map((_, d) => { const st = new Date(now - (minAgo + d * 1440 + 50) * 60000); return { start: ts(st), end: ts(new Date(st.getTime() + 2400000)), sec: 2400 + d * 300, version: d > 2 && !developer ? "4.4.1" : version }; });
    const m = ss[0].start.slice(0, 7);
    w(path.join(dir, "sessions", key, m + ".json"), { key, login, pc, sessions: ss.filter((s) => s.start.startsWith(m)) });
  });
  w(path.join(dir, "nudge", "検査PC-03@tanaka.json"), { key: "検査PC-03@tanaka", version: "4.6.0", by: "maint", at: at(30) });
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
export const STATE_NAMES = ["start", "lot", "info", "settings", "fleet", "release"];
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
  // 設定の窓（この PC の頁・配布の頁・使用状況の頁）
  const settings = async (name, pg) => {
    if (!states.includes(name) || !await page.locator("#btnSettings").isVisible()) return;
    await page.click("#btnSettings");
    await page.waitForSelector("#setModal:not([hidden])");
    if (pg !== "pc") await page.click(`#setTabs [data-page="${pg}"]`);
    await page.waitForTimeout(600);
    await each(name);
    await page.keyboard.press("Escape");
  };
  await settings("settings", "pc");
  await settings("fleet", "fleet");
  await settings("release", "release");
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

// 人の手のように少しずつ動かしてドラッグする（Playwright の dragAndDrop は 2・3 回しか動かさず、PC が重いとブラウザがドラッグを
// 始めないことがある）。始まったか（dragstart）・落としたか（drop）を控えて返す
export async function dragTo(page, from, to) {
  await page.evaluate(() => { window.__drag = []; for (const t of ["dragstart", "drop", "dragend"]) document.addEventListener(t, () => window.__drag.push(t), { capture: true, once: true }); });
  // 表示先の欄は、裏の読み直しで描き直されることがある。位置が取れるまで待つ
  const box = async (s) => { for (let i = 0; i < 50; i++) { const r = await page.locator(s).first().boundingBox().catch(() => null); if (r) return r; await page.waitForTimeout(50); } throw new Error(`見つからない: ${s}`); };
  const a = await box(from), b = await box(to);
  const [x0, y0, x1, y1] = [a.x + 40, a.y + a.height / 2, b.x + b.width / 2, b.y + b.height / 2];
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(x0 + ((x1 - x0) * i) / 12, y0 + ((y1 - y0) * i) / 12);
  await page.mouse.up();
  await page.waitForTimeout(100);
  return page.evaluate(() => window.__drag.join("→") || "（始まらない）");
}
