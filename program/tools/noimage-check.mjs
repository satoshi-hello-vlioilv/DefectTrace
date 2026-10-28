// ロットの木の「画像なし」の札と、一覧の既定の項目（材質・欠陥数）を本物の画面で確かめる（評価関数）。試験のロットで:
//   画像なしのロット（足した設備 DL3 10/24 09:00。上限なし）に「画像なし」の札
//   → 多量のロット（LS3 10/25 08:15）・上限のロット（DL2 10/23 21:27。画像なし）には付けない（記録落ちの可能性。良品とは限らない）
//   → 画像のあるロット（LS3 10/25 22:03）にも付けない → 日の行に「画像なし n」→ 木の検索「画像なし」で絞れる
//   → 一覧の行に材質と欠陥数が出る → 1728・1280 で行の字と札が切れない・札の字は 11px 以上
//   node program/tools/noimage-check.mjs [出力のフォルダ]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import os from "node:os";
import { launch, walk, REPO } from "./ui-harness.mjs";

const out = path.resolve(process.argv[2] || "noimage-check");
fs.mkdirSync(out, { recursive: true });
// 上限の無い画像なしのロットを、別の設備 DL3 に作って足す（試験のロットは正解データと同じに保つ）
const extra = fs.mkdtempSync(path.join(os.tmpdir(), "dt-nimg-"));
execFileSync("python3", ["-c", "import sys; from pathlib import Path; sys.path.insert(0, sys.argv[1]); import fixture_lot as f; f.make_dl2(Path(sys.argv[2]), '2026_10_24_09_00_00', eq='DL3', max_status=0)",
  path.join(REPO, "program/tests"), extra]);
process.env.DT_UI_MORE = JSON.stringify([{ name: "DL3", path: path.join(extra, "DL3") }]);
process.env.DT_UI_LOT = path.join(extra, "DL3/2026/2026_10/2026_10_24/2026_10_24_09_00_00");
let bad = 0;
const check = (ok, what) => { if (!ok) bad++; console.log(`${ok ? "OK  " : "NG  "} ${what}`); };
const app = await launch();
try {
  for (const view of [{ width: 1728, height: 1152 }, { width: 1280, height: 720 }]) {
    const page = await app.newPage(view);
    const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    await walk(page, async () => {}, ["lot"]);
    // LS3 の 10/25（多量のロットと画像のあるロット）と DL2 の 10/23（上限のロット）も開く
    for (const [eq, day] of [["LS3", "10\\/25"], ["DL2", "10\\/23"]]) {
      for (const src of [`^${eq}$`, "^2026$", "^2026\\/10$", `^${day}`]) {
        await page.evaluate(([eq, src]) => { const re = new RegExp(src);
          const top = [...document.querySelectorAll("#tree > li")].find((l) => l.querySelector(":scope>.row .nm")?.textContent === eq);
          const li = [top, ...top.querySelectorAll("li")].find((l) => re.test(l.querySelector(":scope>.row .nm")?.textContent || "") && !l.querySelector(":scope>ul:not([hidden]) > li"));
          li?.querySelector(":scope>.row").click(); }, [eq, src]);
        await page.waitForTimeout(400);
      }
    }
    await page.waitForFunction(() => [...document.querySelectorAll("#tree li.lot")].filter((l) => l.dataset.search).length >= 4, null, { timeout: 15000 });
    await page.waitForTimeout(300);
    const look = await page.evaluate(() => {
      const row = (name) => document.querySelector(`#tree li.lot[data-name^="${name}"]`);
      const nb = (li) => !!li?.querySelector(".fl.nb");
      const nimg = row("2026_10_24_09_00"), dl2 = row("2026_10_23_21_27"), ovl = row("2026_10_25_08_15"), img = row("2026_10_25_22_03");
      const day = (li) => li?.parentElement?.parentElement?.querySelector(":scope>.row .cnt")?.textContent || "";
      const cut = [...document.querySelectorAll("#tree li.lot:not([hidden])")].flatMap((li) => {
        const r = li.getBoundingClientRect();
        return [...li.children].filter((c) => c.scrollWidth > c.clientWidth + 1 || c.getBoundingClientRect().right > r.right + 0.5)
          .map((c) => `${li.dataset.name.slice(11)}:${c.textContent}`);
      });
      const fs = [...document.querySelectorAll("#tree .fl")].map((e) => parseFloat(getComputedStyle(e).fontSize));
      return { nimg: nb(nimg), nimgText: nimg?.querySelector(".fl.nb")?.textContent, ovl: nb(ovl), ovlHas: !!ovl?.querySelector(".fl.ovl"), img: nb(img),
        dl2: nb(dl2), dl2Has: !!dl2?.querySelector(".fl.ovl"), dayNimg: day(nimg), dayDl2: day(dl2), dayLs3: day(img), dl2Vals: dl2 ? [...dl2.querySelectorAll(".v")].map((v) => v.textContent) : [], imgVals: img ? [...img.querySelectorAll(".v")].map((v) => v.textContent) : [],
        legend: document.querySelector("#treePane .nb-leg")?.textContent.replace(/\s+/g, " ").trim() || "", cut, minFs: Math.min(...fs) };
    });
    const w = view.width;
    check(look.nimg && look.nimgText === "画像なし", `${w}: 画像なしのロットに「画像なし」の札（${look.nimgText}）`);
    check(look.ovlHas && !look.ovl, `${w}: 多量のロットには画像なしを付けない（多量の札だけ）`);
    check(look.dl2Has && !look.dl2, `${w}: 上限のロット（画像なし）にも付けない（上限の札だけ）`);
    check(!look.img, `${w}: 画像のあるロットには付けない`);
    check(/画像なし\s*1/.test(look.dayNimg) && !/画像なし/.test(look.dayDl2 + look.dayLs3), `${w}: 日の行に画像なしの数（DL3 10/24「${look.dayNimg}」・DL2 10/23「${look.dayDl2}」・LS3 10/25「${look.dayLs3}」）`);
    // 試験のロット: DL2 は材質なし・欠陥数 53、LS3 22:03 は材質 A5182
    check(look.dl2Vals.includes("53") && look.imgVals.includes("A5182"), `${w}: 一覧の行に材質と欠陥数（DL2「${look.dl2Vals.join("・")}」・LS3「${look.imgVals.join("・")}」）`);
    check(/画像なし.*確かめる画像なし/.test(look.legend) && /多量.*要確認/.test(look.legend), `${w}: 木の下に札の見本（${look.legend}）`);
    check(!look.cut.length, `${w}: 行の字と札が切れない（${look.cut.join(" / ")}）`);
    check(look.minFs >= 11, `${w}: 札の字は 11px 以上（${look.minFs}px）`);
    await page.screenshot({ path: path.join(out, `tree-${w}.png`) });
    await page.fill("#treeFilter", "画像なし");
    await page.waitForTimeout(200);
    const shown = await page.$$eval("#tree li.lot:not([hidden])", (l) => l.map((x) => x.dataset.name));
    check(shown.length === 1 && shown[0].startsWith("2026_10_24_09_00"), `${w}: 木の検索「画像なし」で画像なしのロットだけ（${shown.join("・")}）`);
    await page.fill("#treeFilter", "");
    check(!errs.length, `${w}: 画面のエラーなし ${errs.join(" / ")}`);
    await page.close();
  }
} finally {
  await app.close();
  fs.rmSync(extra, { recursive: true, force: true });
}
console.log(bad ? `NG ${bad} 件` : "全部 OK");
process.exit(bad ? 1 : 0);
