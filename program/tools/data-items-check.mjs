// データ項目の窓を本物の画面で操作して確かめる（作った後の確かめ。撮影は出力フォルダへ）。
//
//   node program/tools/data-items-check.mjs <出力フォルダ>
//
// 試験のロットで: 見出しの「データ項目」で開く → 「幅」で探す（表示項目の名前「板幅」でも当たる）→ 行を押して置く先のボタン →
// 「画像情報」を押して置く（✓ になる）→ もう一度押して外す → 行を本物の「画像表示」の枠へドラッグして置く → Esc で閉じる。
// どれかが違えば、終了コード 1 で止まる。
import fs from "node:fs";
import path from "node:path";
import { launch, walk } from "./ui-harness.mjs";

const OUT = path.resolve(process.argv[2] ?? "data-items-check");
fs.mkdirSync(OUT, { recursive: true });
const app = await launch();
const bad = [];
// 人の手のように少しずつ動かしてドラッグする（Playwright の dragAndDrop は 2・3 回しか動かさず、PC が重いとブラウザがドラッグを
// 始めないことがある）。始まったか（dragstart）・落としたか（drop）を控えて返す
async function dragTo(page, from, to) {
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
const check = (ok, what) => { console.log((ok ? "OK  " : "NG  ") + what); if (!ok) bad.push(what); };
try {
  for (const view of [{ width: 1728, height: 1152 }, { width: 1280, height: 720 }]) {
    const page = await app.newPage(view);
    await walk(page, async () => {}, ["lot"]);
    const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}-${view.width}.png`) });
    await page.click("#btnSources");
    await page.waitForSelector("#srcModal:not([hidden]) #srcRows .drow");
    check(await page.evaluate(() => document.activeElement.id === "srcFilter"), `${view.width}: 開くと探す欄に入る`);
    await shot("browse");
    await page.fill("#srcFilter", "幅");
    await page.waitForTimeout(150);
    const labels = await page.$$eval("#srcRows .drow .dl1 b", (bs) => bs.map((b) => b.textContent));
    check(labels.some((l) => l.includes("板幅")), `${view.width}: 「幅」でロットの「板幅」（表示項目の名前）も当たる: ${labels.join("・")}`);
    const count = await page.$eval("#srcCount", (e) => e.textContent);
    check(count === `${labels.length} 件`, `${view.width}: 件数と並んだ行の数が合う（${count} / ${labels.length}）`);
    await shot("search");
    // 行を押すと置く先のボタン
    const row = page.locator("#srcRows .drow", { hasText: "幅(mm)" }).first();
    await row.click();
    await page.waitForSelector("#srcRows .mq .mb");
    await shot("pick");
    const btn = () => page.locator('#srcRows .mq .mb[data-toggle="image"]');
    const was = await btn().getAttribute("aria-pressed");
    await btn().click();
    await page.waitForFunction((w) => document.querySelector('#srcRows .mq .mb[data-toggle="image"]')?.getAttribute("aria-pressed") !== w, was);
    check((await btn().getAttribute("aria-pressed")) !== was, `${view.width}: 置く先のボタンで「画像情報」を出し入れできる（${was} → 反対）`);
    await btn().click();
    await page.waitForFunction((w) => document.querySelector('#srcRows .mq .mb[data-toggle="image"]')?.getAttribute("aria-pressed") === w, was);
    check((await btn().getAttribute("aria-pressed")) === was, `${view.width}: もう一度押すと元に戻る`);
    // 窓の中の表示先へドラッグ（「サマリ」〈ロット〉には置けず、「画像表示」には置ける）
    const before = await page.$$eval('#srcPlaces .pins[data-place="card"] .chip', (c) => c.length);
    await page.fill("#srcFilter", "ピークレベル明");
    await page.waitForTimeout(150);
    const how = await dragTo(page, "#srcRows .drow", '#srcPlaces .dplace[data-drop="card"]');
    await page.waitForFunction((b) => document.querySelectorAll('#srcPlaces .pins[data-place="card"] .chip').length > b, before, { timeout: 5000 }).catch(() => {});
    const after = await page.$$eval('#srcPlaces .pins[data-place="card"] .chip', (c) => c.length);
    check(after === before + 1, `${view.width}: 行をドラッグして「画像表示」に置ける（${before} → ${after}・${how}）`);
    await page.waitForFunction(() => [...document.querySelectorAll("#grid .th .meta .rw span")].some((x) => x.textContent.includes("ピークレベル明")), null, { timeout: 5000 }).catch(() => {});
    const cardRows = await page.$$eval("#grid .th .meta .rw span", (s) => s.map((x) => x.textContent));
    check(cardRows.some((t) => t.includes("ピークレベル明")), `${view.width}: 置いた項目が画面の画像の下に出る`);
    await shot("dropped");
    await page.keyboard.press("Escape");
    check(await page.$eval("#srcModal", (m) => m.hidden), `${view.width}: Esc で閉じる`);
    // 片付け（置いた項目を外す）
    await page.evaluate(async () => { const ps = await (await fetch("/api/pins")).json(); for (const p of ps.filter((p) => p.key === "peek_level1" && p.place === "card")) await fetch("/api/pins/" + p.id, { method: "DELETE" }); });
    await page.context().close();
  }
} finally {
  await app.close();
}
console.log(bad.length ? `NG ${bad.length} 件` : "全部 OK");
process.exit(bad.length ? 1 : 0);
