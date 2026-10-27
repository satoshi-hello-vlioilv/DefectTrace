// サムネイルの「列の数」を本物の画面で確かめる（評価関数。作った後の確かめ）。
//
//   node program/tools/thumb-cols-check.mjs [出力フォルダ]
//
// 1728・1536・1280 の窓で、列のボタン（1〜最大）を 1 つずつ押し、次を測る:
//  - 1 段に並ぶカードの数＝押した数（最大を超える数は出ない）
//  - 一覧の右の空き（最後のカードの右端から一覧の内側の右端まで）が 8px 未満＝幅に合っている
//  - カードの中の字（項目名・値・面と札・ファイル名）が 1 つも切れていない（…で切った字が無い）
//  - 最大＋1 列にすると字が切れる（＝最大は中身が入る数のいちばん上。小さく見積もっていない）
//  - 選んだ数を覚え、開き直しても同じ数になる
// どれかが違えば、終了コード 1 で止まる。出力フォルダを渡せば、各窓の最大の列の画面を撮る。
import fs from "node:fs";
import path from "node:path";
import { launch, walk } from "./ui-harness.mjs";

const OUT = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const app = await launch();
const bad = [];
const check = (ok, what) => { console.log((ok ? "OK  " : "NG  ") + what); if (!ok) bad.push(what); };
// 頁の中で測る: 1 段目のカードの数・右の空き・切れた字の数
const measure = () => {
  const g = document.getElementById("grid"), cards = [...g.querySelectorAll(".th")].filter((t) => t.firstChild);
  const top = cards[0]?.getBoundingClientRect().top;
  const row = cards.filter((t) => Math.abs(t.getBoundingClientRect().top - top) < 2);
  const inner = g.getBoundingClientRect().left + g.clientLeft + g.clientWidth - 8;
  const right = Math.max(...row.map((t) => t.getBoundingClientRect().right));
  const cut = cards.flatMap((t) => [...t.querySelectorAll(".rw>span,.rw>b,.nm2>*,.nm2 .tbadge")]).filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent);
  return { n: row.length, gap: Math.round(inner - right), cut, max: document.querySelectorAll("#colSeg button").length, on: document.querySelector("#colSeg button.on")?.dataset.cols };
};
try {
  for (const view of [{ width: 1728, height: 1152 }, { width: 1536, height: 864 }, { width: 1280, height: 720 }]) {
    const page = await app.newPage(view);
    await walk(page, async () => {}, ["lot"]);
    const max = await page.$$eval("#colSeg button", (b) => b.length);
    check(max >= 2, `${view.width}: 列のボタンが 1〜${max} 並ぶ`);
    for (let k = 1; k <= max; k++) {
      await page.click(`#colSeg button[data-cols="${k}"]`);
      await page.waitForTimeout(250);
      const m = await page.evaluate(measure);
      check(m.n === k && m.on === String(k) && m.gap >= 0 && m.gap < 8 && !m.cut.length,
        `${view.width}: ${k} 列 → 1 段に ${m.n} 枚・右の空き ${m.gap}px・切れた字 ${m.cut.length}${m.cut.length ? `（${m.cut.slice(0, 3).join("・")}）` : ""}`);
    }
    if (OUT) await page.screenshot({ path: path.join(OUT, `max-${view.width}.png`) });
    // 最大は小さく見積もっていない: 最大＋1 列の幅にすると字が切れる
    const over = await page.evaluate((k) => {
      const g = document.getElementById("grid"), w = g.clientWidth - 16;
      g.style.setProperty("--ts", Math.floor((w - 8 * k) / (k + 1)) - 40 + "px");
      return new Promise((r) => requestAnimationFrame(() => r(Math.max(...[...g.querySelectorAll(".th .rw>span,.th .rw>b,.th .nm2>*")].map((e) => e.scrollWidth - e.clientWidth)))));
    }, max);
    check(over > 0 || max === 12, `${view.width}: 最大 ${max} 列は中身が入るいちばん上（${max + 1} 列の幅では字が ${over}px 切れる）`);
    // 覚える: 2 列を選んで開き直す
    await page.click('#colSeg button[data-cols="2"]');
    await page.reload();
    await page.waitForFunction(() => window.__dtReady === true && document.querySelectorAll("#grid .th img").length > 0);
    await page.waitForTimeout(400);
    const after = await page.evaluate(measure);
    check(after.on === "2" && after.n === 2, `${view.width}: 選んだ列の数を覚える（開き直して ${after.on} 列・1 段に ${after.n} 枚）`);
    await page.evaluate(() => localStorage.removeItem("thumbCols"));
    await page.context().close();
  }
} finally {
  await app.close();
}
console.log(bad.length ? `NG ${bad.length} 件` : "全部 OK");
process.exit(bad.length ? 1 : 0);
