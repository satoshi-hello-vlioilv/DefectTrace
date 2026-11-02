// 画像の仕分けと拡大画像の計測を、本物の画面で通しで確かめる（評価関数）。試験のロット（LS3 10/25 22:03・画像 24 枚）で:
//   仕分け: グループを作り名前を付ける → 分類が「穴」の画像のカードを 3 枚ドラッグ → 条件に「分類 = 穴」が出る → 見本に塗りの札・ほかの穴に枠の札
//          → 行を押すと一覧が穴の画像だけに絞られ、フィルタの帯に札と「n / 24 枚」が出る → グループ順で見出しが出る → 帯の × で外れる
//   計測: 拡大の窓でドラッグ → 帯に長さ（mm と px）・右の欄に一覧と欠陥データとの比べ → Shift＋ドラッグで枠（幅 × 長さ）→ 右クリックで消える
//   どれも 1728・1280 で、はみ出し・横のスクロールが無い
//   node program/tools/classify-check.mjs [出力のフォルダ]
import fs from "node:fs";
import path from "node:path";
import { launch, walk, measure, dragTo } from "./ui-harness.mjs";

const out = path.resolve(process.argv[2] || "classify-check");
fs.mkdirSync(out, { recursive: true });
let bad = 0;
const check = (ok, what, info = "") => { if (!ok) bad++; console.log(`${ok ? "OK  " : "NG  "} ${what}${info ? ` -- ${info}` : ""}`); };
const app = await launch();
try {
  for (const view of [{ width: 1728, height: 1152 }, { width: 1280, height: 720 }]) {
    const page = await app.newPage(view);
    const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    await walk(page, async () => {}, ["lot"]);
    await page.evaluate(() => fetch("/api/classes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groups: [] }) }));
    await page.reload(); await page.waitForFunction(() => window.__dtReady === true);
    await page.waitForFunction(() => window.dtClass.ctx() && document.querySelectorAll("#grid .th img").length > 0);
    const W = view.width;
    // ---- 仕分け
    await page.click("#clsPane [data-new]");
    await page.fill("#clsPane [data-name]", "穴");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => /穴/.test(document.querySelector("#clsPane .cls-g .nm")?.textContent || ""));
    const holes = await page.evaluate(async () => {
      const c = window.dtClass.ctx();
      const m = await (await fetch("/api/imgmap?" + new URLSearchParams({ lot: c.lot, g: c.g }))).json();
      return Object.entries(m.map).filter(([, v]) => v.kname === "穴").map(([k]) => k).sort();
    });
    check(holes.length >= 4, "試験のロットに穴の画像が 4 枚以上", holes.join(" "));
    const drags = [];
    for (const k of holes.slice(0, 3)) {
      const sel = `#grid .th[data-key="img/${k}"]`;
      await page.locator(sel).scrollIntoViewIfNeeded();
      drags.push(await dragTo(page, sel, "#clsPane .cls-g"));
      await page.waitForTimeout(400);
    }
    check(drags.every((d) => d.includes("drop")), "カードを 3 枚、グループの行へドラッグできる", drags.join(" / "));
    await page.waitForFunction(() => /= 穴/.test(document.querySelector("#clsPane .cls-g .rule")?.textContent || ""), null, { timeout: 20000 }).catch(() => {});
    const rule = await page.textContent("#clsPane .cls-g .rule");
    check(/= 穴/.test(rule), "見本 3 枚から条件を割り出す（分類 = 穴）", rule);
    const tags = await page.evaluate(() => ({ ex: document.querySelectorAll("#grid .th>.ctag.ex").length, hit: [...document.querySelectorAll("#grid .th>.ctag:not(.ex)")].length, n: document.querySelector("#clsPane .cls-g .n").textContent }));
    check(tags.ex === 3, "見本 3 枚に塗りの札「見本」", JSON.stringify(tags));
    check(/見本 3\/3 ・ [1-9]/.test(tags.n), "行に 見本 3/3 と当てはまる枚数", tags.n);
    // 絞る
    await page.click("#clsPane .cls-g .nm");
    await page.waitForTimeout(300);
    const narrowed = await page.evaluate((holes) => {
      const shown = [...document.querySelectorAll("#grid .th:not(.fo)")].map((t) => t.dataset.key.slice(t.dataset.key.indexOf("/") + 1));
      return { shown, onlyHoles: shown.every((k) => holes.includes(k)), chip: document.querySelector("#fChips .cls-chip")?.textContent || "", count: document.getElementById("fCount").textContent };
    }, holes);
    check(narrowed.onlyHoles && narrowed.shown.length === holes.length, "行を押すと一覧が穴の画像だけになる", `${narrowed.shown.length} 枚`);
    check(/仕分け: 穴/.test(narrowed.chip) && new RegExp(`${holes.length} / 24`).test(narrowed.count), "フィルタの帯に札と枚数", `${narrowed.chip} / ${narrowed.count}`);
    // グループ順
    await page.click('#clsPane [data-sort="group"]');
    await page.waitForTimeout(200);
    const g1 = await page.evaluate(() => document.querySelector("#grid>.gsep")?.textContent || "");
    check(/穴/.test(g1) && /枚/.test(g1), "グループ順で見出し（記号・名前・枚数・CAB の内訳）", g1);
    await page.screenshot({ path: path.join(out, `classify-${W}.png`) });
    const m1 = await page.evaluate(measure);
    check(m1.cut === 0 && !m1.hscroll, `${W}: はみ出し・横のスクロールが無い（仕分け）`, JSON.stringify(m1));
    // 帯の × で外す・CAB 順に戻す
    await page.click("#fChips [data-cls-off]");
    await page.waitForTimeout(200);
    check(await page.evaluate(() => !document.querySelector("#fChips .cls-chip") && document.querySelectorAll("#grid .th.fo").length === 0), "帯の × で絞り込みが外れる");
    await page.click('#clsPane [data-sort="cab"]');

    // ---- 計測
    await page.dblclick(`#grid .th[data-key="img/${holes[0]}"]`);
    await page.waitForFunction(() => document.getElementById("vImg").complete && document.getElementById("vImg").naturalWidth > 0);
    await page.waitForTimeout(500);
    const box = await page.locator("#vImg").boundingBox();
    const pt = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
    const drag = async (a, b, shift) => {
      if (shift) await page.keyboard.down("Shift");
      await page.mouse.move(...a); await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(a[0] + ((b[0] - a[0]) * i) / 8, a[1] + ((b[1] - a[1]) * i) / 8);
      await page.mouse.up();
      if (shift) await page.keyboard.up("Shift");
      await page.waitForTimeout(150);
    };
    await page.waitForFunction(() => /物差し/.test(document.getElementById("mScale").textContent));
    await drag(pt(0.25, 0.3), pt(0.5, 0.6));
    const r1 = await page.evaluate(() => ({ val: document.getElementById("mVal").textContent, parts: document.getElementById("mParts").textContent, rows: document.querySelectorAll("#vInfo .msrbox tr").length, scale: document.getElementById("mScale").textContent, lines: document.querySelectorAll("#mSvg line.mk-line").length }));
    check(/mm$/.test(r1.val) && /px/.test(r1.parts) && r1.lines === 1, "ドラッグで線: 帯に長さ（mm）と 幅・長さ・px", `${r1.val} / ${r1.parts} / ${r1.scale}`);
    check(r1.rows >= 2, "右の欄に計測の一覧", `${r1.rows} 行`);
    await drag(pt(0.55, 0.2), pt(0.8, 0.45), true);
    const r2 = await page.evaluate(() => ({ val: document.getElementById("mVal").textContent, cmp: document.querySelector("#vInfo .msrbox .mcmp")?.textContent || "", rects: document.querySelectorAll("#mSvg rect.mk-line").length }));
    check(/^幅 .* × 長さ .* mm$/.test(r2.val) && r2.rects === 1, "Shift＋ドラッグで枠（幅 × 長さ）", r2.val);
    check(/欠陥データ/.test(r2.cmp) && /1\.2/.test(r2.cmp) && /2\.5/.test(r2.cmp), "欠陥データの幅・長さと並べて比べる", r2.cmp.replace(/\s+/g, " "));
    await page.screenshot({ path: path.join(out, `measure-${W}.png`) });
    const m2 = await page.evaluate(measure);
    check(m2.cut === 0 && !m2.hscroll, `${W}: はみ出し・横のスクロールが無い（計測）`, JSON.stringify(m2));
    // 「合わせる…」を開くと画像が下がって縮む。線と枠も一緒に描き直され、画像の同じ所に重なる（作った後の採点 2026-11-02 で見つかったずれ）
    // 線の終わりの端が、絵（全体表示では要素の箱の中に縦横比を保って収まる範囲）のどの割合の所にあるか。開く前と後で同じなら重なっている
    const endFrac = () => page.evaluate(() => {
      const l = document.querySelector("#mSvg line.mk-line"), s = document.getElementById("vStage"), r = s.getBoundingClientRect(), im = document.getElementById("vImg"), b = im.getBoundingClientRect();
      const k = Math.min(b.width / im.naturalWidth, b.height / im.naturalHeight), pw = im.naturalWidth * k, ph = im.naturalHeight * k, px = b.left + (b.width - pw) / 2, py = b.top + (b.height - ph) / 2;
      const x = r.left - s.scrollLeft + +l.getAttribute("x2"), y = r.top - s.scrollTop + +l.getAttribute("y2");
      return { f: [(x - px) / pw, (y - py) / ph], size: [pw, ph], top: py }; });
    const before = await endFrac();
    await page.click("#mCalBtn");
    await page.waitForTimeout(300);
    const after = await endFrac(), off = Math.hypot((after.f[0] - before.f[0]) * after.size[0], (after.f[1] - before.f[1]) * after.size[1]);
    const moved = Math.abs(after.size[1] - before.size[1]) + Math.abs(after.top - before.top);
    check(moved > 5 && off < 1, "「合わせる…」を開いて画像が動いても・縮んでも、線は画像の同じ所に重なる", `絵の上 ${before.top.toFixed(0)} → ${after.top.toFixed(0)}・高さ ${before.size[1].toFixed(0)} → ${after.size[1].toFixed(0)} px・ずれ ${off.toFixed(2)} px`);
    const btn = await page.evaluate(() => { const b = document.querySelector("#mCal [data-calx]"), s = getComputedStyle(b); return [s.color, s.backgroundColor]; });
    check(btn[0] !== btn[1] && !/226, 230, 236/.test(btn[0]), "合わせる欄の「閉じる」が読める色", btn.join(" / "));
    await page.click("#mCal [data-calx]");
    await page.waitForTimeout(200);
    // 横に引いた線: 比べの表は幅だけ（長さ 0.00 mm を出さない）。枠がある間は枠と比べるので、枠を消してから
    await page.evaluate(() => document.querySelectorAll("#vInfo [data-mdel]")[1].click());
    const b3 = await page.locator("#vImg").boundingBox();
    await drag([b3.x + b3.width * 0.2, b3.y + b3.height * 0.8], [b3.x + b3.width * 0.7, b3.y + b3.height * 0.8]);
    const flat = await page.evaluate(() => [...document.querySelectorAll("#vInfo .msrbox .mcmp tr td:first-child")].map((x) => x.textContent));
    check(flat.join() === "幅", "横の線は、比べの表に幅だけ", flat.join("・"));
    await page.mouse.click(...pt(0.1, 0.9), { button: "right" });
    await page.waitForTimeout(150);
    check(await page.evaluate(() => document.querySelectorAll("#mSvg .mk-line").length === 1), "右クリックで最後の 1 つが消える");
    check(await page.evaluate(() => document.querySelectorAll("#vInfo .msrbox > table:first-of-type tr").length === 2), "一覧も 1 行になる");
    check(errs.length === 0, `${W}: 画面のエラーが無い`, errs.join(" / "));
    await page.context().close();
  }
} finally {
  await app.close();
}
console.log(bad ? `NG ${bad} 件` : "すべて OK");
process.exit(bad ? 1 : 0);
