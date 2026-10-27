// ロット表の速さを、大きな設備（数百〜数千ロット）で測る（画面に出ない改良の根拠・評価関数）。
//
//   node program/tools/lotlist-bench.mjs <設備のフォルダ> [--json <書き出す先>]
//
// 設備のフォルダ（設備 > 年 > 年月 > 日 > ロット）を木に足して起こし、5 つの場面を順に測る:
//   1 初回        … ロット表で設備を押し、全部の値を読み終えるまで
//   2 もう一度    … 別の日を押してから設備に戻る（同じロットをもう一度）
//   3 画面の開き直し … 頁を読み直して、設備をもう一度（画面の覚えは消える）
//   4 アプリの起動し直し … 試しの入口を止めて、同じ作業場所で起こし直し、設備をもう一度
//   5 広げる      … 新しい作業場所で、まず 1 日だけ、次にその月へ広げる（月の分の数）
// 場面ごとに、読み終えるまでの時間・裏が読んだバイト数と読んだ回数（/proc/<pid>/io の rchar・syscr。
// 共有フォルダ〈Box・ネットワーク〉ではここが時間になる）・画面のいちばん長い止まり・裏のメモリのいちばん多い時を出す。
// 最後に、送った先にも行が描かれていること（見える行だけを描くため）と、全件の CSV の時間を確かめる。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launch, walk } from "./ui-harness.mjs";

const dir = process.argv[2];
if (!dir) { console.error("使い方: node program/tools/lotlist-bench.mjs <設備のフォルダ> [--json <書き出す先>]"); process.exit(2); }
const jsonOut = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;
const EQ = [{ name: "BIG", path: path.resolve(dir) }];
const io = (pid) => { try { const t = fs.readFileSync(`/proc/${pid}/io`, "utf8"); return { rchar: +t.match(/rchar:\s+(\d+)/)[1], syscr: +t.match(/syscr:\s+(\d+)/)[1] }; } catch { return { rchar: 0, syscr: 0 }; } };
const rss = (pid) => { try { return +fs.readFileSync(`/proc/${pid}/status`, "utf8").match(/VmRSS:\s+(\d+)/)[1] / 1024; } catch { return 0; } };
const results = [];

async function openList(app) {
  const page = await app.newPage({ width: 1728, height: 1152 });
  await walk(page, async () => {}, ["lot"]);
  await page.click('#modeBar [data-mode="list"]');
  await page.waitForFunction(() => document.querySelector("#lvLoad").hidden && document.querySelector("#lvBody tr"));
  return page;
}
// 押して（sel: 押す所）、表が読み終えるまでを測る（scope: 表の範囲の終わりの名前）
async function measure(app, page, name, sel, scope) {
  await page.evaluate(() => { window.__lag = 0; let t = performance.now(); clearInterval(window.__lagT); window.__lagT = setInterval(() => { const n = performance.now(); window.__lag = Math.max(window.__lag, n - t - 50); t = n; }, 50); });
  const io0 = io(app.pid);
  let peak = rss(app.pid);
  const tick = setInterval(() => { peak = Math.max(peak, rss(app.pid)); }, 200);
  const t0 = Date.now();
  await page.click(sel);
  await page.waitForFunction((s) => (document.querySelector("#lvScope b")?.innerText || "").endsWith(s) && document.querySelector("#lvLoad").hidden
    && document.querySelectorAll("#lvBody tr[data-path]").length > 0 && !document.querySelector("#lvBody td.lv-wait"), scope, { timeout: 600000 });
  const ms = Date.now() - t0;
  clearInterval(tick);
  const io1 = io(app.pid);
  const lag = await page.evaluate(() => Math.round(window.__lag));
  const n = await page.$eval("#lotTableN", (e) => e.textContent);
  const r = { 場面: name, ロット: n, 秒: +(ms / 1000).toFixed(2), 読んだMB: +((io1.rchar - io0.rchar) / 1048576).toFixed(1), 読んだ回数: io1.syscr - io0.syscr, 止まりms: lag, メモリMB: Math.round(peak) };
  results.push(r);
  console.log(`${name.padEnd(14, "　")} ロット ${n}・${r.秒} 秒・読んだ ${r.読んだMB} MB / ${r.読んだ回数} 回・画面の止まり ${lag} ms・裏のメモリ ${r.メモリMB} MB`);
  return page;
}
const EQSEL = '#tree > li[data-eq="BIG"] > .row';
// 画像の窓のまま、木を設備 > 年 > 年月 > 日 と開く（画像の窓では押しても開くだけ。表の範囲は変わらない）
async function openToDay(page) {
  const sel = (n) => `#tree > li[data-eq="BIG"]${" > ul > li:not(.lot)".repeat(n)}`;
  for (let n = 0; n < 3; n++) {
    await page.click(`${sel(n)} > .row`);
    await page.waitForSelector(`${sel(n + 1)} > .row`);
  }
  const name = (n) => page.$eval(`${sel(n)} > .row .nm`, (e) => e.textContent);
  return { day: sel(3), dayLabel: await name(3), month: sel(2), monthLabel: await name(2) };
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), "dt-bench-home-"));
try {
  // 1・2・3（同じ作業場所・同じアプリ）
  let app = await launch(undefined, EQ, { home });
  let page = await openList(app);
  await measure(app, page, "1 初回", EQSEL, "BIG");
  await page.click('#tree > li[data-eq="LS3"] > .row');   // 別の設備（試験のロット）を見てから戻る
  await page.waitForFunction(() => (document.querySelector("#lvScope b")?.innerText || "").endsWith("LS3") && document.querySelector("#lvLoad").hidden, null, { timeout: 600000 });
  await measure(app, page, "2 もう一度", EQSEL, "BIG");
  await page.reload();
  await page.waitForFunction(() => window.__dtReady === true);
  await page.click('#modeBar [data-mode="list"]');
  await page.waitForFunction(() => document.querySelector("#lvLoad").hidden);
  await measure(app, page, "3 画面の開き直し", EQSEL, "BIG");
  // 送った先にも行が描かれている・全件の CSV
  for (const at of [0.37, 1, 0]) {
    const seen = await page.evaluate(async (at) => {
      const w = document.querySelector("#lvWrap"); w.scrollTop = (w.scrollHeight - w.clientHeight) * at;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const box = w.getBoundingClientRect(), head = document.querySelector("#lvHead th").getBoundingClientRect().bottom;   // 見出しは th が貼り付く
      const vis = [...document.querySelectorAll("#lvBody tr[data-path]")].filter((tr) => { const b = tr.getBoundingClientRect(); return b.bottom > head && b.top < Math.min(box.bottom, innerHeight); });
      return { vis: vis.length, wait: vis.filter((tr) => tr.querySelector(".lv-wait")).length };
    }, at);
    if (!seen.vis || seen.wait) { console.log(`NG 送り ${Math.round(at * 100)}%: 見える行 ${seen.vis}・読めていない行 ${seen.wait}`); process.exitCode = 1; }
  }
  const t1 = Date.now();
  await Promise.all([page.waitForEvent("download"), page.click("#lvCsv")]);
  console.log(`（全件の CSV ${((Date.now() - t1) / 1000).toFixed(1)} 秒・送った先の行 OK）`);
  await app.close();
  // 4 アプリの起動し直し（同じ作業場所）
  app = await launch(undefined, EQ, { home });
  page = await openList(app);
  await measure(app, page, "4 起動し直し", EQSEL, "BIG");
  await app.close();
  // 5 広げる（新しい作業場所: 1 日 → その月）
  app = await launch(undefined, EQ);
  page = await app.newPage({ width: 1728, height: 1152 });
  await walk(page, async () => {}, ["lot"]);
  const e = await openToDay(page);
  await page.click(`${e.day} > .row`);   // 範囲にする日（画像の窓では開くだけ。最後に押した節が表の範囲になる）
  await measure(app, page, "5a 1 日", '#modeBar [data-mode="list"]', e.dayLabel);
  await measure(app, page, "5b その月へ広げる", `${e.month} > .row`, e.monthLabel);
  await app.close();
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(results, null, 1));
