// ロット一覧（リスト表示）を本物の画面で操作して確かめる（作った後の確かめ。撮影は出力フォルダへ）。
//
//   node program/tools/lotlist-check.mjs <出力フォルダ>
//
// 試験のロットで: ロット一覧を開く → 木の設備（LS3。試験のロットは 2 つ）を押して範囲を広げる → 表示列の窓を開く → 式で作る列（[板厚] * 1000）を足す →
// 見出しを押して並べ替え → 検索で絞る → CSV と Excel に書き出し、保存された中身（見出し・行の数・式の答え）を確かめる。
// どれかが違えば、終了コード 1 で止まる。
import fs from "node:fs";
import path from "node:path";
import { launch, walk } from "./ui-harness.mjs";

const OUT = path.resolve(process.argv[2] ?? "lotlist-check");
fs.mkdirSync(OUT, { recursive: true });
const app = await launch();
const bad = [];
const check = (ok, what) => { console.log((ok ? "OK  " : "NG  ") + what); if (!ok) bad.push(what); };
try {
  for (const view of [{ width: 1728, height: 1152 }, { width: 1280, height: 720 }]) {
    const page = await app.newPage(view);
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await walk(page, async () => {}, ["lot"]);
    const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}-${view.width}.png`) });
    await page.click('#viewSeg button[data-v="list"]');
    await page.waitForFunction(() => document.querySelectorAll("#lvBody tr").length > 0 && !document.querySelector("#lvBody td.lv-wait"), null, { timeout: 15000 });
    const day = await page.$$eval("#lvBody tr", (t) => t.length);
    check(day === 2, `${view.width}: 開いているロットの日（10/25）の 2 ロットが並ぶ（${day}）`);
    // 範囲のパンくずで月へ広げる（木の側で範囲を決め直し、木の上でも範囲の節が光る）
    await page.click('#lvScope button[data-i="2"]');
    await page.waitForFunction(() => /2026\/10$/.test(document.querySelector("#lvScope b")?.innerText || "") && document.querySelector("#lvLoad").hidden, null, { timeout: 15000 });
    const lit = await page.$$eval("#tree li.scope > .row .nm", (e) => e.map((x) => x.textContent));
    check(lit.length === 1 && lit[0] === "2026/10", `${view.width}: パンくずで範囲を月に広げ、木でも月の節が示される（${lit.join("・")}）`);
    // 範囲を設備全体へ（木の設備を押す。表の窓では押した節を開いたまま範囲にする＝木が畳まれない）
    await page.click("#tree > li > .row");
    await page.waitForFunction(() => !/2026/.test(document.querySelector("#lvScope").innerText) && document.querySelector("#lvLoad").hidden && !document.querySelector("#lvBody td.lv-wait"), null, { timeout: 15000 });
    const all = await page.$$eval("#lvBody tr", (t) => t.length);
    const scope = await page.$eval("#lvScope", (e) => e.innerText.replace(/\s+/g, " ").trim());
    check(all === 2 && /LS3/.test(scope), `${view.width}: 木の設備を押すと、範囲が設備の下の全ロットになる（${all} ロット・範囲「${scope}」）`);
    const open = await page.$eval("#tree > li > ul", (u) => !u.hidden);
    check(open, `${view.width}: 設備を押しても木が畳まれない`);
    await shot("list");
    // 表示列の窓（LotScope と同じ）
    await page.click("#lvCols");
    await page.waitForSelector("#llColumnPanel:not([hidden]) #lcList .lc-row");
    const rows = await page.$$eval("#lcList .lc-row", (r) => r.length);
    check(rows > 10, `${view.width}: 表示列の窓が開き、ロット単位の列が並ぶ（${rows} 列）`);
    await shot("columns");
    await page.click("#lcClose");
    // 式で作る列（表示列の設定に式を入れる。窓の「＋ 列を作る」と同じ所に入る）
    await page.evaluate(() => {
      const LC = window.LotListColumns, t = "defecttrace:lots", l = LC.layoutOf(t);
      l.formulas["板厚×1000"] = "[板厚] * 1000";
      l.order = ["板厚×1000", ...l.order.filter((c) => c !== "板厚×1000")];
      LC.replaceLayout(t, l); window.DTLotList.render();
    });
    await page.waitForTimeout(300);
    const calc = await page.$$eval("#lvBody tr", (trs) => { const i = [...document.querySelectorAll("#lvHead th")].findIndex((th) => th.dataset.col === "板厚×1000"); return trs.map((tr) => tr.children[i]?.textContent); });
    check(calc.length && calc.every((v) => v === "245"), `${view.width}: 式で作る列 [板厚] * 1000 の答え（${calc.join("・")}）`);
    // 並べ替え（作業時刻の見出しを 2 回押す＝大きい順）
    const timeCol = await page.$$eval("#lvHead th", (ths) => ths.findIndex((th) => /時刻/.test(th.innerText)));
    await page.click(`#lvHead th:nth-child(${timeCol + 1}) .th-in`);
    await page.click(`#lvHead th:nth-child(${timeCol + 1}) .th-in`);
    const times = await page.$$eval("#lvBody tr", (trs, i) => trs.map((tr) => tr.children[i].textContent), timeCol);
    check(JSON.stringify(times) === JSON.stringify([...times].sort().reverse()), `${view.width}: 見出しを押して大きい順に並ぶ（${times.join("・")}）`);
    // 検索
    await page.fill("#lvSearch", "08:15");
    await page.waitForTimeout(150);
    const hit = await page.$$eval("#lvBody tr", (t) => t.length);
    check(hit >= 1 && hit < all, `${view.width}: 検索で絞る（${hit} / ${all}）`);
    await page.fill("#lvSearch", "");
    // 書き出し（全件・表示列の見え方のまま）
    for (const [btn, ext] of [["#lvCsv", "csv"], ["#lvXlsx", "xlsx"]]) {
      // 名前は画面が付けた物（a.download）を読む（頭なしの Chromium は日本語の名前を「download」に置き換えて渡すため）
      await page.evaluate(() => { const c = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { window.__dlName = this.download; return c.call(this); }; });
      const [dl] = await Promise.all([page.waitForEvent("download"), page.click(btn)]);
      const name = await page.evaluate(() => window.__dlName);
      const file = path.join(OUT, `export-${view.width}.${ext}`);
      await dl.saveAs(file);
      const buf = fs.readFileSync(file);
      if (ext === "csv") {
        const lines = buf.toString("utf8").replace(/^﻿/, "").trim().split(/\r\n/);
        check(lines.length === all + 1 && lines[0].includes("板厚×1000") && lines.slice(1).every((l) => l.includes('"245"')) && /^ロット一覧_LS3_\d{8}-\d{4}\.csv$/.test(name),
          `${view.width}: CSV に見出し＋全 ${all} 行・式の答えが入る（${lines.length - 1} 行・${name}）`);
      } else {
        check(buf.subarray(0, 2).toString() === "PK" && buf.length > 1000 && name.endsWith(".xlsx"), `${view.width}: Excel（.xlsx）を書き出す（${buf.length} バイト・${name}）`);
      }
    }
    check(!errs.length, `${view.width}: 画面の誤りが出ない（${errs.join(" / ") || "なし"}）`);
    // 片付け（式の列を外す）
    await page.evaluate(() => { const LC = window.LotListColumns, t = "defecttrace:lots", l = LC.layoutOf(t); delete l.formulas["板厚×1000"]; l.order = l.order.filter((c) => c !== "板厚×1000"); LC.replaceLayout(t, l); });
    await page.context().close();
  }
} finally {
  await app.close();
}
console.log(bad.length ? `NG ${bad.length} 件` : "全部 OK");
process.exit(bad.length ? 1 : 0);
