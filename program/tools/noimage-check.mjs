// ロットの木の「画像なし」の札と、一覧の既定の項目（材質・欠陥数）を本物の画面で確かめる（評価関数）。試験のロットで:
//   画像なしのロット（DL2 10/23 21:27）に「画像なし」の札 → 多量のロット（LS3 10/25 08:15）には付けない（多量は処理落ちの可能性。良品とは限らない）
//   → 画像のあるロット（LS3 10/25 22:03）にも付けない → 日の行に「画像なし n」→ 木の検索「画像なし」で絞れる
//   → 一覧の行に材質と欠陥数が出る → 1728・1280 で行の字と札が切れない・札の字は 11px 以上
//   node program/tools/noimage-check.mjs [出力のフォルダ]
import fs from "node:fs";
import path from "node:path";
import { launch, walk } from "./ui-harness.mjs";

const out = path.resolve(process.argv[2] || "noimage-check");
fs.mkdirSync(out, { recursive: true });
process.env.DT_UI_LOT = "DL2/2026/2026_10/2026_10_23/2026_10_23_21_27_46";
let bad = 0;
const check = (ok, what) => { if (!ok) bad++; console.log(`${ok ? "OK  " : "NG  "} ${what}`); };
const app = await launch();
try {
  for (const view of [{ width: 1728, height: 1152 }, { width: 1280, height: 720 }]) {
    const page = await app.newPage(view);
    const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    await walk(page, async () => {}, ["lot"]);
    // LS3 の 10/25 も開く（多量のロットと画像のあるロット）
    for (const re of [/^LS3$/, /^2026$/, /^2026\/10$/, /^10\/25/]) {
      await page.evaluate((src) => { const re = new RegExp(src);
        const li = [...document.querySelectorAll("#tree li")].find((l) => re.test(l.querySelector(":scope>.row .nm")?.textContent || "") && !l.querySelector(":scope>ul:not([hidden]) > li"));
        li?.querySelector(":scope>.row").click(); }, re.source);
      await page.waitForTimeout(400);
    }
    await page.waitForFunction(() => [...document.querySelectorAll("#tree li.lot")].filter((l) => l.dataset.search).length >= 3, null, { timeout: 15000 });
    await page.waitForTimeout(300);
    const look = await page.evaluate(() => {
      const row = (name) => document.querySelector(`#tree li.lot[data-name^="${name}"]`);
      const nb = (li) => !!li?.querySelector(".fl.nb");
      const dl2 = row("2026_10_23_21_27"), ovl = row("2026_10_25_08_15"), img = row("2026_10_25_22_03");
      const day = (li) => li?.parentElement?.parentElement?.querySelector(":scope>.row .cnt")?.textContent || "";
      const cut = [...document.querySelectorAll("#tree li.lot:not([hidden])")].flatMap((li) => {
        const r = li.getBoundingClientRect();
        return [...li.children].filter((c) => c.scrollWidth > c.clientWidth + 1 || c.getBoundingClientRect().right > r.right + 0.5)
          .map((c) => `${li.dataset.name.slice(11)}:${c.textContent}`);
      });
      const fs = [...document.querySelectorAll("#tree .fl")].map((e) => parseFloat(getComputedStyle(e).fontSize));
      return { dl2: nb(dl2), dl2Text: dl2?.querySelector(".fl.nb")?.textContent, ovl: nb(ovl), ovlHas: !!ovl?.querySelector(".fl.ovl"), img: nb(img),
        dayDl2: day(dl2), dayLs3: day(img), dl2Vals: dl2 ? [...dl2.querySelectorAll(".v")].map((v) => v.textContent) : [], cut, minFs: Math.min(...fs) };
    });
    const w = view.width;
    check(look.dl2 && look.dl2Text === "画像なし", `${w}: 画像なしのロットに「画像なし」の札（${look.dl2Text}）`);
    check(look.ovlHas && !look.ovl, `${w}: 多量のロットには画像なしを付けない（多量の札だけ）`);
    check(!look.img, `${w}: 画像のあるロットには付けない`);
    check(/画像なし\s*1/.test(look.dayDl2) && !/画像なし/.test(look.dayLs3), `${w}: 日の行に画像なしの数（10/23「${look.dayDl2}」・10/25「${look.dayLs3}」）`);
    check(look.dl2Vals.length >= 2 && look.dl2Vals.includes("53"), `${w}: 一覧の行に材質と欠陥数（${look.dl2Vals.join("・")}）`);
    check(!look.cut.length, `${w}: 行の字と札が切れない（${look.cut.join(" / ")}）`);
    check(look.minFs >= 11, `${w}: 札の字は 11px 以上（${look.minFs}px）`);
    await page.screenshot({ path: path.join(out, `tree-${w}.png`) });
    await page.fill("#treeFilter", "画像なし");
    await page.waitForTimeout(200);
    const shown = await page.$$eval("#tree li.lot:not([hidden])", (l) => l.map((x) => x.dataset.name.slice(11)));
    check(shown.length === 1 && shown[0].startsWith("2026_10_23_21_27"), `${w}: 木の検索「画像なし」で画像なしのロットだけ（${shown.join("・")}）`);
    await page.fill("#treeFilter", "");
    check(!errs.length, `${w}: 画面のエラーなし ${errs.join(" / ")}`);
    await page.close();
  }
} finally {
  await app.close();
}
console.log(bad ? `NG ${bad} 件` : "全部 OK");
process.exit(bad ? 1 : 0);
