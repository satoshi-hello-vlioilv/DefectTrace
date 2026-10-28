// 同じデータ項目は、どこに置いても同じ名前・同じ単位・同じ値で出るかを確かめる（評価関数）。試験のロットで、
// 初期の「検査長(m)」（INSP_INFO の insp_end_y を ×0.001 した m）を例に:
//   データ項目の窓の行が、名前（検査長(m)）どおりの単位の値を出す → 置く先のボタンで「ロット一覧」に置く → 名前と倍率が同じになり、
//   一覧の値がサマリの値と同じ → ドラッグで「ロット情報」に置く → 同じ → 「名前を付けて置く」は名前だけ変わり、単位（倍率）は同じ
//   node program/tools/item-label-check.mjs [出力のフォルダ]
import fs from "node:fs";
import path from "node:path";
import { dragTo, launch, parseView, walk } from "./ui-harness.mjs";

const out = path.resolve(process.argv[2] || "item-label-check");
fs.mkdirSync(out, { recursive: true });
let bad = 0;
const check = (ok, what) => { if (!ok) bad++; console.log(`${ok ? "OK  " : "NG  "} ${what}`); };
const h = await launch(undefined, [], {});
try {
  const page = await h.newPage(parseView("1728x1152"));
  const errs = []; page.on("pageerror", (e) => errs.push(e.stack || e.message));
  await walk(page, async () => {}, ["lot"]);
  const pins = () => page.evaluate(() => fetch("/api/pins").then((r) => r.json()));
  const KEY = "insp_end_y";
  const of = async (place) => (await pins()).find((p) => p.key === KEY && p.place === place);
  const sumVal = await page.evaluate(() => [...document.querySelectorAll("#summary .chip")].find((c) => /検査長\(m\)/.test(c.textContent))?.querySelector(".cv")?.textContent);
  check(/^\d+\.\d\d$/.test(sumVal || ""), `サマリの検査長(m) は m の値（${sumVal}）`);
  const openRow = async () => {
    if (await page.locator("#srcModal").isHidden()) await page.click("#btnSources");
    await page.fill("#srcFilter", KEY);
    await page.waitForSelector(`#srcRows tr.src[data-key="${KEY}"]`);
    return page.locator(`#srcRows tr.src[data-key="${KEY}"]`).first();
  };
  let row = await openRow();
  const rowName = await row.locator(".dl1 b").textContent(), rowVal = (await row.locator(".dv").textContent()).trim();
  check(rowName === "検査長(m)" && rowVal === sumVal, `データ項目の窓の行: 名前 ${rowName}・値 ${rowVal}（サマリ ${sumVal} と同じか）`);
  await page.screenshot({ path: path.join(out, "row.png") });

  // 置く先のボタンで「ロット一覧」へ
  await row.click();
  await page.click('#srcRows .mq .mb[data-toggle="list"]');
  await page.waitForFunction(() => /一覧/.test(document.getElementById("status").textContent));
  let p = await of("list");
  check(p && p.label === "検査長(m)" && p.scale === 0.001, `置く先のボタン: 名前 ${p?.label}・倍率 ${p?.scale}`);
  await page.keyboard.press("Escape");
  await page.waitForFunction((v) => [...document.querySelectorAll("#tree li.lot.sel span, #tree li.lot span")].some((s) => s.textContent === v), sumVal, { timeout: 15000 }).catch(() => {});
  const listHas = await page.evaluate((v) => [...document.querySelectorAll("#tree li.lot span")].some((s) => s.textContent === v), sumVal);
  check(listHas, `ロット一覧の値がサマリと同じ（${sumVal}）`);

  // ドラッグで「ロット情報」へ
  row = await openRow();
  const how = await dragTo(page, `#srcRows tr.src[data-key="${KEY}"]`, '#srcPlaces .dplace[data-drop="lot"]');
  await page.waitForFunction(() => /ロット情報/.test(document.getElementById("status").textContent)).catch(() => {});
  p = await of("lot");
  check(p && p.label === "検査長(m)" && p.scale === 0.001, `ドラッグ（${how}）: 名前 ${p?.label}・倍率 ${p?.scale}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  const lotVal = await page.evaluate(() => [...document.querySelectorAll("#lotInfo tr.pinned")].find((r) => /検査長/.test(r.textContent))?.children[1]?.textContent);
  check(lotVal === sumVal, `ロット情報の値がサマリと同じ（${lotVal} / ${sumVal}）`);

  // 名前を付けて置く（名前は利用者の物・単位は同じ）
  row = await openRow();
  await row.click();
  await page.click("#srcRows .mq [data-named]");
  await page.fill("#pinLabel", "停止までの長さ(m)");
  await page.selectOption("#pinPlace", "summary");
  await page.click('#pinPop button[type="submit"]');
  await page.waitForTimeout(500);
  p = (await pins()).find((x) => x.key === KEY && x.label === "停止までの長さ(m)");
  check(p && p.scale === 0.001, `名前を付けて置く: 名前 ${p?.label}・倍率 ${p?.scale}`);
  check(!errs.length, `画面のエラーなし ${errs.join(" / ")}`);
} finally {
  await h.close();
}
console.log(bad ? `NG ${bad} 件` : "全部 OK");
process.exit(bad ? 1 : 0);
