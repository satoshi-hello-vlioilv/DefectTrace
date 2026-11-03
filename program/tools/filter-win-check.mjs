// フィルタを作る窓（T2: 大きな窓・3 列・大きさを変えて覚える）を本物の画面で確かめる（評価関数）。試験のロット（24 枚）で:
//   開くと「大」（画面の 94%×90%・1600×940 まで）→ 3 列（登録した条件と例｜作る所｜当てはまる画像）が横に並ぶ
//   → 「例から作る」の長さで条件の形（長さ ≥）と名前が入る → 値を入れると、当てはまる数・見本の格子・分布の棒・値の線と札・目盛りが出る
//   → 置き場は 1 行（どの幅でも選ぶ所が折れない）・作る所の列に横のはみ出しが無い
//   → 「中」「全画面」で大きさが変わり、閉じて開き直しても残る → 右下の角で変えた大きさも残る（中・大・全画面の選びは外れる）
//   node program/tools/filter-win-check.mjs [出力のフォルダ]
import fs from "node:fs";
import path from "node:path";
import { launch, parseView } from "./ui-harness.mjs";

const out = path.resolve(process.argv[2] || "filter-win-check");
fs.mkdirSync(out, { recursive: true });
let bad = 0;
const check = (ok, what) => { if (!ok) bad++; console.log(`${ok ? "OK  " : "NG  "} ${what}`); };
const near = (a, b, tol = 3) => Math.abs(a - b) <= tol;
const h = await launch(undefined, [], {});
try {
  for (const view of ["1728x1152", "1536x864", "1280x720"].map(parseView)) {
    const page = await h.newPage(view);
    const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    const lot = await page.evaluate(() => window.__dtFx);
    await page.evaluate((p) => { localStorage.setItem("lastLot", p); localStorage.removeItem("dtFilterWin"); }, lot);
    await page.reload(); await page.waitForFunction(() => window.__dtReady === true);
    await page.waitForFunction(() => window.dtFilter.ctx() && document.querySelectorAll("#grid .th").length === 24, null, { timeout: 30000 });
    const W = view.width;
    const open = async () => { await page.click("#fOpen"); await page.waitForSelector("#fEd #fName"); await page.waitForTimeout(300); };
    const close = async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(150); };
    const size = () => page.evaluate(() => { const w = document.getElementById("fWin"); return { w: w.offsetWidth, h: w.offsetHeight,
      on: [...document.querySelectorAll("#fSize .on")].map((b) => b.dataset.fs).join(""), vw: innerWidth, vh: innerHeight }; });

    await open();
    let s = await size();
    check(near(s.w, Math.min(1600, s.vw * 0.94)) && near(s.h, Math.min(940, s.vh * 0.9)) && s.on === "l", `${W}: 開くと「大」（${s.w}×${s.h} / 画面 ${s.vw}×${s.vh}）`);
    const cols = await page.evaluate(() => ["fLib", "fEd", "fRes"].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width), Math.round(r.top)]; }));
    check(cols[0][0] < cols[1][0] && cols[1][0] < cols[2][0] && cols.every((c) => near(c[2], cols[0][2])) && cols[2][1] >= 300 && cols[1][1] >= 420,
      `${W}: 3 列が横に並ぶ（幅 ${cols.map((c) => c[1]).join("・")}px）`);

    // 例から作る（長さ）→ 値 2
    const ex = await page.locator('#fLib [data-ex]').allTextContents();
    check(ex.length >= 4 && ex.some((t) => t.startsWith("長さ")), `${W}: 例から作るが出る（${ex.length} 個）`);
    await page.click('#fLib [data-ex="0"]');
    await page.waitForTimeout(200);
    const made = await page.evaluate(() => ({ field: document.querySelector('#fEd select[data-k="field"]').value, op: document.querySelector('#fEd select[data-k="op"]').value,
      name: document.getElementById("fName").value, focus: document.activeElement?.dataset?.k || "" }));
    check(made.field === "length_mm" && made.op === ">=" && made.name === "長い欠陥" && made.focus === "v", `${W}: 例を押すと条件の形と名前が入り、値の欄に入る（${JSON.stringify(made)}）`);
    await page.fill('#fEd input[data-k="v"]', "2");
    await page.waitForFunction(() => /当てはまる画像/.test(document.getElementById("fLive").textContent) && document.querySelectorAll("#fPrev .f-pv").length > 0, null, { timeout: 10000 });
    await page.waitForTimeout(400);
    const res = await page.evaluate(() => {
      const bars = [...document.querySelectorAll("#fHist i")], box = document.getElementById("fHist").getBoundingClientRect();
      const ed = document.getElementById("fEd"), sc = [...document.querySelectorAll("#fEd .f-scope label")].map((l) => Math.round(l.getBoundingClientRect().top));
      const pv = document.querySelector("#fPrev .f-pv img").getBoundingClientRect();
      return { live: document.getElementById("fLive").textContent, prev: document.querySelectorAll("#fPrev .f-pv").length, pvw: Math.round(pv.width),
        bars: bars.length, tall: Math.max(...bars.map((b) => b.offsetHeight)), boxh: Math.round(box.height),
        mark: document.querySelector("#fHist .f-mark b")?.textContent || "", shade: !!document.querySelector("#fHist .f-shade"), axis: document.querySelectorAll("#fAxis span").length,
        scopeOneLine: new Set(sc).size === 1, edOver: ed.scrollWidth - ed.clientWidth };
    });
    check(/24/.test(res.live) && res.prev === 24 && res.pvw >= 100, `${W}: 当てはまる数と見本の格子（${res.live}・見本 ${res.prev} 枚・幅 ${res.pvw}px）`);
    check(res.bars > 0 && res.tall >= 60 && res.boxh >= 150, `${W}: 分布の箱が大きく、棒が箱の高さで描かれる（箱 ${res.boxh}px・いちばん高い棒 ${res.tall}px）`);
    check(res.mark === "≥ 2" && res.shade && res.axis === 3, `${W}: 分布に値の線と札（${res.mark}）・当てはまる側の塗り・目盛り 3 つ`);
    check(res.scopeOneLine && res.edOver <= 0, `${W}: 置き場の選ぶ所が 1 行・作る所に横のはみ出しが無い（${res.edOver}px）`);
    await page.screenshot({ path: path.join(out, `filter-${W}.png`) });

    // 大きさ: 中 → 開き直しても中 → 全画面 → 右下の角で変えた大きさ → 開き直しても残る
    await page.click('#fSize [data-fs="m"]'); await page.waitForTimeout(200);
    s = await size();
    check(near(s.w, Math.min(1120, s.vw * 0.94)) && near(s.h, Math.min(720, s.vh * 0.9)) && s.on === "m", `${W}: 「中」で小さくなる（${s.w}×${s.h}）`);
    await page.screenshot({ path: path.join(out, `filter-m-${W}.png`) });
    await close(); await open();
    s = await size();
    check(s.on === "m" && near(s.w, Math.min(1120, s.vw * 0.94)), `${W}: 閉じて開き直しても「中」のまま`);
    await page.click('#fSize [data-fs="full"]'); await page.waitForTimeout(200);
    s = await size();
    check(near(s.w, s.vw - 24) && near(s.h, s.vh - 24) && s.on === "full", `${W}: 「全画面」で画面いっぱい（${s.w}×${s.h}）`);
    // 右下の角のドラッグ（ブラウザが style の幅と高さを書く）
    const box = await page.locator("#fWin").boundingBox();
    await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 150, box.y + box.height - 100, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    s = await size();
    const kept = await page.evaluate(() => localStorage.getItem("dtFilterWin"));
    check(s.on === "" && s.w < s.vw - 100 && /"w"/.test(kept), `${W}: 右下の角で変えると、その大きさを覚え、中・大・全画面の選びが外れる（${s.w}×${s.h}・${kept}）`);
    const before = s;
    await close(); await open();
    s = await size();
    check(near(s.w, before.w) && near(s.h, before.h) && s.on === "", `${W}: 閉じて開き直しても角で変えた大きさ（${s.w}×${s.h}）`);
    await page.click('#fSize [data-fs="l"]'); await page.waitForTimeout(200);
    s = await size();
    check(s.on === "l" && near(s.w, Math.min(1600, s.vw * 0.94)), `${W}: 「大」に戻せる`);
    await close();
    check(!errs.length, `${W}: 画面の誤りが出ない（${errs.join(" / ") || "なし"}）`);
    await page.context().close();
  }
} finally {
  await h.close();
}
console.log(bad ? `FAILED（${bad} 件）` : "OK（すべて）");
process.exit(bad ? 1 : 0);
