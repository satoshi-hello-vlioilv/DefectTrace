// 大きなロットを開いたときの「待ち」を、画面（本物の app.js）で測る（読み込みの速さと進捗の見え方の評価関数）。
//
//   python program/tests/fixture_lot.py <置き場> --bench 200 256 200      # CAB 200 個 × 100 枚 = 2 万枚のロット
//   node program/tools/open-check.mjs <ロット> [出力フォルダ] [--runs 2] [--images 20000]
//
// 試しの入口（serve）を、そのロットだけの設備で起こし、前に開いたロット（lastLot）として開き直させて、開いた瞬間からの秒を測る:
//   first     最初のカード（画像の枠）が出る
//   cards     全部のカードが並ぶ
//   linked    カードに欠陥データ（分類）が付く（画像と欠陥の対応付けが済む）
//   done      読み込みが済んだと画面が言う（下の帯が「… 枚 / …秒」になる）
//   block     画面が固まった時間の合計（50ms を超えた長い仕事の、超えた分の合計）と、いちばん長い 1 回（longest）
//   blank     読み込み中なのに、進み（何を・どこまで・あとどれくらい）が画面に出ていなかった時間
// 0.25 秒ごとに、画面に出ている進みの字を控え、1 秒・3 秒の所で撮る（出力フォルダがあれば）。
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { REPO } from "./ui-harness.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const [lotArg, outArg, ...rest] = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
if (!lotArg) { console.error("使い方: node program/tools/open-check.mjs <ロット> [出力フォルダ] [--runs 2]"); process.exit(2); }
const opt = (n, d) => (process.argv.includes(n) ? +process.argv[process.argv.indexOf(n) + 1] : d);
const RUNS = opt("--runs", 2), IMAGES = opt("--images", 20000);
void rest;
const LOT = path.resolve(lotArg);
const OUT = outArg ? path.resolve(outArg) : null;
const EQ = path.resolve(LOT, "..", "..", "..", "..");   // 設備 > 年 > 年月 > 日 > ロット

const exe = path.join(REPO, "desktop/target/release/examples/serve");
if (!fs.existsSync(exe)) execFileSync("cargo", ["build", "--release", "--example", "serve"], { cwd: path.join(REPO, "desktop"), stdio: "inherit" });

async function once(run) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "dt-open-"));
  const cfg = path.join(work, "config.json");
  fs.writeFileSync(cfg, JSON.stringify({ equipments: [{ name: "BIG", path: EQ }] }));
  const port = 5900 + Math.floor(Math.random() * 300);
  const proc = spawn(exe, ["--port", String(port), "--config", cfg, "--home", path.join(work, "home")], { stdio: "ignore" });
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(url)).ok) break; } catch { /* 起動待ち */ } await new Promise((r) => setTimeout(r, 100)); }
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1728, height: 1152 }, deviceScaleFactor: 1.25, locale: "ja-JP" });
  const page = await ctx.newPage();
  await page.addInitScript((lot) => {
    localStorage.setItem("lastLot", lot);
    window.__long = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([e.startTime, e.duration]); }).observe({ type: "longtask", buffered: true });
  }, LOT);
  const t0 = Date.now();
  await page.goto(url);
  const seen = { first: null, cards: null, linked: null, done: null };
  const samples = [];
  let shot = 0;
  for (;;) {
    const s = await page.evaluate(() => {
      const vis = (el) => el && !el.hidden && el.offsetParent !== null && getComputedStyle(el).visibility !== "hidden";
      // 進みの字: 進みの枠（#prog・#loadBox など、data-progress の付いた物）と下の帯
      const prog = [...document.querySelectorAll("[data-progress], #prog")].filter(vis).map((e) => e.innerText.replace(/\s+/g, " ").trim()).filter(Boolean).join(" | ");
      return { cards: document.querySelectorAll("#grid .th").length, linked: document.querySelectorAll("#grid .th .meta legend:not(.sub)").length,
        status: document.getElementById("status")?.textContent || "", prog, busy: !!document.querySelector("[data-loading='1']") || /展開中|読込中|開いています/.test(document.getElementById("grid")?.innerText.slice(0, 200) || "") };
    }).catch(() => null);
    const t = (Date.now() - t0) / 1000;
    if (!s) { await page.waitForTimeout(100); continue; }
    if (s.cards && seen.first == null) seen.first = t;
    if (s.cards >= IMAGES && seen.cards == null) seen.cards = t;
    if (s.linked && seen.linked == null) seen.linked = t;
    const done = /枚 \/ .*秒/.test(s.status);
    samples.push({ t: Math.round(t * 100) / 100, ...s });
    if (OUT && run === 0 && ((shot === 0 && t >= 1) || (shot === 1 && t >= 3))) {
      fs.mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: path.join(OUT, `open-${shot ? 3 : 1}s.png`) });
      shot++;
    }
    if (done && seen.done == null) { seen.done = t; break; }
    if (t > 180) break;
    await page.waitForTimeout(250);
  }
  if (OUT && run === 0) await page.screenshot({ path: path.join(OUT, "open-done.png") });
  const long = await page.evaluate(() => window.__long);
  await browser.close(); proc.kill(); fs.rmSync(work, { recursive: true, force: true });
  // 進みが出ていなかった時間: 済むまでの間で、進みの字が空だった標本の間隔の合計
  let blank = 0;
  for (let i = 1; i < samples.length; i++) if (!samples[i - 1].prog) blank += samples[i].t - samples[i - 1].t;
  const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
  return { first: r2(seen.first), cards: r2(seen.cards), linked: r2(seen.linked), done: r2(seen.done),
    block: r2(long.reduce((a, [, d]) => a + Math.max(0, d - 50), 0) / 1000), longest: r2(Math.max(0, ...long.map(([, d]) => d)) / 1000),
    blank: r2(blank), longs: long.filter(([, d]) => d > 150).map(([s, d]) => `${r2(s / 1000)}s:${Math.round(d)}ms`), progress: [...new Set(samples.map((s) => `${s.t}s ${s.prog || "（なし）"}`))].filter((_, i) => i % 4 === 0).slice(0, 14) };
}

const results = [];
for (let i = 0; i < RUNS; i++) { const r = await once(i); results.push(r); console.log(JSON.stringify(r)); }
if (OUT) fs.writeFileSync(path.join(OUT, "open-check.json"), JSON.stringify(results, null, 1));
