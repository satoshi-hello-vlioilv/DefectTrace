// ロット表の速さを、大きな設備（数千ロット）で測る（画面に出ない改良の根拠）。
//
//   node program/tools/lotlist-bench.mjs <設備のフォルダ> [--slow-cols]
//
// 設備のフォルダを木に足して起こし、ロット表を開いてから木の設備を押し、次の時刻を測る:
//  - 行が並ぶまで（ロットを集め、列の目録を作り、表を描く）
//  - 進みの帯が消えるまで（全ロットの値を読み終える）
// 1 秒ごとに帯の字（いまの段階・数・残り時間）を書き出す。最後に、全件の CSV を書き出すまでの時間も測る。
// 固まり方も測る: 画面の止まり（50ms ごとの合図が遅れたいちばん長い時間）と、裏（試しの入口）の使うメモリのいちばん多い時。
import fs from "node:fs";
import path from "node:path";
import { launch, walk } from "./ui-harness.mjs";

const dir = process.argv[2];
if (!dir) { console.error("使い方: node program/tools/lotlist-bench.mjs <設備のフォルダ>"); process.exit(2); }
const app = await launch(undefined, [{ name: "BIG", path: path.resolve(dir) }]);
try {
  const page = await app.newPage({ width: 1728, height: 1152 });
  await walk(page, async () => {}, ["lot"]);
  await page.click('#modeBar [data-mode="list"]');
  await page.waitForFunction(() => document.querySelector("#lvLoad").hidden && document.querySelector("#lvBody tr[data-path]"));
  // 画面の止まり: 50ms ごとの合図の遅れのいちばん長い所
  await page.evaluate(() => { window.__lag = 0; let t = performance.now(); window.__lagT = setInterval(() => { const n = performance.now(); window.__lag = Math.max(window.__lag, n - t - 50); t = n; }, 50); });
  const rss = () => { try { return +fs.readFileSync(`/proc/${app.pid}/status`, "utf8").match(/VmRSS:\s+(\d+)/)[1] / 1024; } catch { return 0; } };
  let peak = rss();
  const t0 = Date.now();
  await page.click('#tree > li[data-eq="BIG"] > .row');
  const band = setInterval(async () => {
    const s = await page.evaluate(() => { const b = document.querySelector("#lvLoad"); return b.hidden ? "（帯なし）" : b.innerText.replace(/\s+/g, " "); }).catch(() => "");
    peak = Math.max(peak, rss());
    console.log(`${((Date.now() - t0) / 1000).toFixed(1)} 秒: ${s}（裏のメモリ ${Math.round(rss())} MB）`);
  }, 1000);
  await page.waitForFunction(() => /BIG$/.test(document.querySelector("#lvScope b")?.innerText || "") && document.querySelectorAll("#lvBody tr[data-path]").length > 1, null, { timeout: 120000 });
  const rows = Date.now() - t0;
  await page.waitForFunction(() => document.querySelector("#lvLoad").hidden, null, { timeout: 600000 });
  const all = Date.now() - t0;
  clearInterval(band);
  const lag = await page.evaluate(() => { clearInterval(window.__lagT); return Math.round(window.__lag); });
  const n = await page.$eval("#lotTableN", (e) => e.textContent);
  // 送った先にも行が描かれている（見える行だけを描くため、送りの途中・底・頭で確かめる）
  for (const at of [0.37, 1, 0]) {
    const seen = await page.evaluate(async (at) => {
      const w = document.querySelector("#lvWrap"); w.scrollTop = (w.scrollHeight - w.clientHeight) * at;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const box = w.getBoundingClientRect(), head = document.querySelector("#lvHead th").getBoundingClientRect().bottom;   // 見出しは th が貼り付く（thead は送られる）
      const vis = [...document.querySelectorAll("#lvBody tr[data-path]")].filter((tr) => { const b = tr.getBoundingClientRect(); return b.bottom > head && b.top < Math.min(box.bottom, innerHeight); });
      return { h: vis.slice(0, 3).map((tr) => Math.round(tr.getBoundingClientRect().height)), vis: vis.length, wait: vis.filter((tr) => tr.querySelector(".lv-wait")).length, first: vis[0]?.querySelector("b")?.textContent };
    }, at);
    if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}-${Math.round(at * 100)}.png` });
    console.log(`送り ${Math.round(at * 100)}%: 見える行 ${seen.vis}・読めていない行 ${seen.wait}・先頭 ${seen.first}・行の高さ ${seen.h}`);
    if (!seen.vis || seen.wait) process.exitCode = 1;
  }
  const t1 = Date.now();
  await Promise.all([page.waitForEvent("download"), page.click("#lvCsv")]);
  console.log(`画面のいちばん長い止まり ${lag} ms・裏のメモリのいちばん多い時 ${Math.round(peak)} MB`);
  console.log(`ロット ${n}・行が並ぶまで ${(rows / 1000).toFixed(1)} 秒・全部の値を読み終えるまで ${(all / 1000).toFixed(1)} 秒・CSV ${((Date.now() - t1) / 1000).toFixed(1)} 秒`);
} finally {
  await app.close();
}
