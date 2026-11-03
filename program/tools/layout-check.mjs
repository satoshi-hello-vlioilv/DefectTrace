// 機能ブロックの配置（layout-view.js・G3）を本物の画面で通しで確かめる（評価関数）。試験のロットに、本物のように日のフォルダを足して木を長くし:
//   仕分けが木に押しつぶされない（左の欄の 4 割以上）→ 境目のドラッグで高さが変わる → 名前を押すとたたみ、残りが広がる
//   → ⠿ でつかんで右の欄へ移す（移している間「ここへ移す」の線）→ ⋯ のメニューは移せる先だけ・字が折れない
//   → 「画面の配置」で左2列（仕分けが 2 列目へ・MAP の図と凡例が見える・中央が残る）・左・中・中・右・左・中・右に戻す
//   → よく使う形（仕分けを広く）・元に戻す → ロット表では画像のブロックを出さず、木は出る → 開き直しても配置が残る → 画面の誤りが出ない
//   node program/tools/layout-check.mjs [出力のフォルダ]
import fs from "node:fs";
import path from "node:path";
import { launch, parseView } from "./ui-harness.mjs";

const out = path.resolve(process.argv[2] || "layout-check");
fs.mkdirSync(out, { recursive: true });
let bad = 0;
const check = (ok, what) => { if (!ok) bad++; console.log(`${ok ? "OK  " : "NG  "} ${what}`); };
const LONG = () => { const eq = document.querySelector("#tree>li"); const ul = eq.querySelector(":scope>ul") || eq.appendChild(document.createElement("ul"));
  for (let i = 0; i < 26; i++) ul.insertAdjacentHTML("afterbegin", `<li><div class="row"><span class="tw">▶</span><span class="nm">2026/09/${String(28 - i).padStart(2, "0")} (月)</span><span class="cnt">${3 + (i % 5)}ロット</span></div></li>`); };
const h = await launch(undefined, [], {});
try {
  for (const view of ["1728x1152", "1280x720"].map(parseView)) {
    const W = view.width;
    const page = await h.newPage(view);
    const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    const lot = await page.evaluate(() => window.__dtFx);
    await page.evaluate((p) => { localStorage.setItem("lastLot", p); localStorage.removeItem("dtLayout"); for (const k of Object.keys(localStorage)) if (k.startsWith("w_")) localStorage.removeItem(k); }, lot);
    const reopen = async () => {
      await page.reload(); await page.waitForFunction(() => window.__dtReady === true);
      await page.waitForFunction(() => window.dtFilter.ctx() && document.querySelectorAll("#grid .th").length === 24, null, { timeout: 30000 });
      await page.evaluate(LONG); await page.waitForTimeout(300);
    };
    await reopen();
    const box = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e || !e.offsetParent) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }, sel);
    const colOf = (id) => page.evaluate((i) => document.querySelector(`.blk[data-blk="${i}"]`).closest(".dock").id, id);

    // 1. 仕分けが押しつぶされない
    let pane = await box("#treePane"), cls = await box('.blk[data-blk="cls"]'), add = await box("#clsPane .cls-add");
    check(cls.h >= pane.h * 0.4 && add && add.y + add.h <= cls.y + cls.h, `${W}: 木が長くても仕分けは左の欄の 4 割以上（${Math.round(cls.h)} / ${Math.round(pane.h)}px）・「＋ グループを作る」まで見える`);
    // MAP: 図・凡例・横縦の受けの下端がブロックの中（下の境目・ブロックに隠れない）・受けの「横」「縦」の札と名前が同じ行
    // 描いた枠（表面・裏面）の下端・右端が canvas の大きさに収まる（解像度を書き換えた直後の大きさで描くと、絵の下と右が切れる）
    const drawnIn = () => page.evaluate(async () => {
      const m = document.getElementById("map"), sr = CanvasRenderingContext2D.prototype.strokeRect, rects = [];
      CanvasRenderingContext2D.prototype.strokeRect = function (...a) { if (this.canvas === m) rects.push(a); return sr.apply(this, a); };
      window.dispatchEvent(new Event("resize")); await new Promise((r) => setTimeout(r, 200));
      CanvasRenderingContext2D.prototype.strokeRect = sr;
      return rects.length > 0 && rects.every(([x, y, w, h]) => y + h <= m.clientHeight + 0.5 && x + w <= m.clientWidth + 0.5);
    });
    const mapOk = async () => (await drawnIn()) && page.evaluate(() => { const m = document.getElementById("map"), lg = document.getElementById("mapLegend"), s = document.querySelector(".blk[data-blk=map] .slots"), bb = document.querySelector(".blk[data-blk=map]>.bb").getBoundingClientRect();
      const r = (e) => e.getBoundingClientRect();
      const oneLine = [...s.querySelectorAll(".slot")].every((sl) => { const l = sl.querySelector(".dzl"), c = sl.querySelector(".chip"); return !c || Math.abs(r(l).top + r(l).height / 2 - (r(c).top + r(c).height / 2)) < 4; });
      return { canvas: Math.round(m.clientHeight), legendIn: r(m).bottom <= bb.bottom + 1 && r(lg).bottom <= bb.bottom + 1 && r(s).bottom <= bb.bottom + 1 && oneLine }; });
    // 画像情報: ブロックの中に見えている行の数
    const imgRows = () => page.evaluate(() => { const b = document.querySelector(".blk[data-blk=img]>.bb").getBoundingClientRect();
      return [...document.querySelectorAll("#imgInfo tr")].filter((t) => { const r = t.getBoundingClientRect(); return r.height && r.bottom <= b.bottom + 1; }).length; });
    let mp = (await mapOk()) || { canvas: 0, legendIn: false };
    check(mp.canvas >= 90 && mp.legendIn, `${W}: MAP の図（${mp.canvas}px）の下端・凡例・横縦の受けがブロックの中に見える（受けは 1 行）`);
    const rows = await imgRows();
    check(rows >= 6, `${W}: 画像情報が中を送らずに 6 行以上見える（${rows} 行）`);
    await page.screenshot({ path: path.join(out, `lot-${W}.png`) });

    // 2. 境目のドラッグで高さ（離すと残る）
    const sp = await box('#treePane>.hsplit');
    const before = (await box('.blk[data-blk="tree"]')).h;
    await page.mouse.move(sp.x + sp.w / 2, sp.y + 4); await page.mouse.down();
    await page.mouse.move(sp.x + sp.w / 2, sp.y + 4 + 90, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(150);
    const after = (await box('.blk[data-blk="tree"]')).h;
    check(Math.abs(after - before - 90) <= 6, `${W}: 境目を 90px 下げると、ロットのブロックが ${Math.round(after - before)}px 高くなる`);

    // 3. 名前を押すとたたむ → 仕分けが広がる → もう一度で開く
    await page.click('.blk[data-blk="tree"] .bt'); await page.waitForTimeout(150);
    const folded = await box('.blk[data-blk="tree"]'), wide = await box('.blk[data-blk="cls"]');
    check(folded.h < 40 && wide.h > pane.h * 0.85, `${W}: ロットをたたむと見出しだけ（${Math.round(folded.h)}px）・仕分けが欄いっぱい（${Math.round(wide.h)}px）`);
    await page.click('.blk[data-blk="tree"] .bt'); await page.waitForTimeout(150);

    // 4. ⠿ でつかんで右の欄の MAP の上へ（移している間「ここへ移す」の線）
    const g = await box('.blk[data-blk="cls"] .grip'), mapb = await box('.blk[data-blk="map"]');
    await page.mouse.move(g.x + 5, g.y + 5); await page.mouse.down();
    await page.mouse.move(mapb.x + mapb.w / 2, mapb.y + 20, { steps: 12 });
    const during = await page.evaluate(() => { const l = document.querySelector("#infoPane>.drop-line"); return { line: !!l, nextIsMap: l?.nextElementSibling?.dataset.blk === "map", ghost: !!document.querySelector(".lay-ghost") }; });
    await page.screenshot({ path: path.join(out, `drag-${W}.png`) });
    await page.mouse.up(); await page.waitForTimeout(200);
    const order = await page.evaluate(() => [...document.querySelectorAll("#infoPane>.blk")].map((b) => b.dataset.blk).join(","));
    check(during.line && during.nextIsMap && during.ghost && order === "img,cls,map,lot", `${W}: ⠿ でつかんで右の欄へ移す（線 ${during.line}・札 ${during.ghost}・右の欄 ${order}）`);
    // 移した先でも使える: 「＋ グループを作る」までブロックの中に見える。入りきらなければほかをたたみ、そう知らせる
    const room = await page.evaluate(() => { const b = document.querySelector(".blk[data-blk=cls]>.bb").getBoundingClientRect(), a = document.querySelector("#clsPane .cls-add").getBoundingClientRect(), col = document.getElementById("infoPane");
      return { addIn: a.bottom <= b.bottom + 1, fits: col.scrollHeight <= col.clientHeight + 1, folded: Object.keys(window.dtLayout.get().fold).filter((k) => window.dtLayout.get().fold[k]).join(","), status: document.getElementById("status").textContent }; });
    check(room.addIn && room.fits && (!room.folded.replace("lot", "") || /たたみました/.test(room.status)),
      `${W}: 移した先で「＋ グループを作る」まで見え、欄に収まる（たたんだ物: ${room.folded || "なし"}${/たたみました/.test(room.status) ? `・知らせ「${room.status}」` : ""}）`);

    // 5. ⋯ のメニュー: 移せる先だけ（いまの欄は出ない）・字が 1 行
    await page.click('.blk[data-blk="cls"] .bmore'); await page.waitForTimeout(100);
    const m = await page.evaluate(() => [...document.querySelectorAll(".blk-menu button")].map((b) => [b.textContent.trim(), Math.round(b.getBoundingClientRect().height)]));
    await page.screenshot({ path: path.join(out, `blkmenu-${W}.png`) });
    const names = m.map((x) => x[0]);
    check(names.includes("左の欄へ") && !names.includes("右の欄へ") && names.includes("2 列目を足して移す") && m.every((x) => x[1] <= 32), `${W}: ⋯ に移せる先だけ・1 行（${names.join("／")}）`);
    await page.click('.blk-menu button:has-text("左の欄へ")'); await page.waitForTimeout(150);
    const reopened = await page.evaluate(() => ["img", "map"].every((id) => !window.dtLayout.get().fold[id]));
    check(await colOf("cls") === "treePane" && reopened, `${W}: ⋯ の「左の欄へ」で戻り、場所が足りずにたたんだ右のブロックは開き直る`);

    // 6. 画面の配置 → 左2列・中・右
    await page.click("#layBtn"); await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(out, `laymenu-${W}.png`) });
    await page.click('[data-mode-set="llcr"]'); await page.waitForTimeout(400);
    const c2 = await box("#col2"), center = await box("#center");
    mp = (await mapOk()) || { canvas: 0, legendIn: false };
    check(c2 && await colOf("cls") === "col2" && center.w >= 400 && mp.canvas >= 90 && mp.legendIn && await imgRows() >= 6,
      `${W}: 左2列で仕分けが 2 列目へ（中央 ${Math.round(center.w)}px・MAP の図 ${mp.canvas}px・凡例が見える）`);
    // フィルタの帯: はみ出さない。説明が入りきらないときは省略記号で切る（字の途中で黙って切らない）
    const cut = await page.evaluate(() => { const f = document.querySelector("#fBar"), n = document.querySelector("#fChips .f-none");
      return { over: f.scrollWidth - f.clientWidth, silent: !!n && n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).textOverflow !== "ellipsis" }; });
    check(cut.over <= 0 && !cut.silent, `${W}: 左2列でもフィルタの帯がはみ出さず、説明は省略記号で切る（はみ出し ${cut.over}px）`);
    // MAP の描き方と形は 1 行（右の欄が細くても折れない）
    const mk = await page.evaluate(() => { const r = [...document.querySelectorAll(".mkbar .mk-row")[1].querySelectorAll(":scope>.mk-fld")].map((f) => Math.round(f.getBoundingClientRect().top)); return new Set(r).size; });
    check(mk === 1, `${W}: 左2列でも MAP の「描き方」と「形」が 1 行`);
    await page.screenshot({ path: path.join(out, `cols-${W}.png`) });

    // 7. 左・中 → 右のブロックが左へ・右の欄は隠れる／中・右 → 左のブロックが右へ／左・中・右で元の場所
    const mode = async (k) => { await page.click("#layBtn"); await page.click(`[data-mode-set="${k}"]`); await page.waitForTimeout(250); };
    await mode("lc");
    let st = await page.evaluate(() => ({ right: !document.getElementById("infoPane").hidden, left: [...document.querySelectorAll("#treePane>.blk")].map((b) => b.dataset.blk).join(",") }));
    check(!st.right && st.left === "tree,cls,img,map,lot", `${W}: 左・中で右のブロックが左の欄の下へ（${st.left}）`);
    await mode("cr");
    st = await page.evaluate(() => ({ left: !document.getElementById("treePane").hidden, right: [...document.querySelectorAll("#infoPane>.blk")].map((b) => b.dataset.blk).join(",") }));
    check(!st.left && st.right.startsWith("tree,cls"), `${W}: 中・右で左のブロックが右の欄の上へ（${st.right}）`);
    await mode("lcr");
    st = await page.evaluate(() => ({ l: [...document.querySelectorAll("#treePane>.blk")].map((b) => b.dataset.blk).join(","), r: [...document.querySelectorAll("#infoPane>.blk")].map((b) => b.dataset.blk).join(",") }));
    check(st.l.includes("tree") && st.r.includes("map"), `${W}: 左・中・右に戻すと、空いた欄に標準のブロックが戻る（左 ${st.l}／右 ${st.r}）`);

    // 8. よく使う形・元に戻す
    await page.click("#layBtn"); await page.click('[data-preset="cls"]'); await page.waitForTimeout(250);
    check(await colOf("cls") === "col2" && await colOf("tree") === "treePane", `${W}: 「仕分けを広く」で仕分けが 2 列目`);
    await page.click("#layBtn"); await page.click("[data-undo]"); await page.waitForTimeout(250);
    check(await colOf("cls") !== "col2" && !(await box("#col2")), `${W}: 「元に戻す」で 1 つ前の配置`);
    await page.click("#layBtn"); await page.click('[data-preset="std"]'); await page.waitForTimeout(250);

    // 9. ロット表: 画像のブロックは出さない・木は右の欄へ移しても出る
    await page.evaluate(() => document.querySelector('#modeBar [data-mode="list"]').click()); await page.waitForTimeout(400);
    st = await page.evaluate(() => ({ img: !!document.querySelector(".blk[data-blk=map]").offsetParent, tree: !!document.querySelector(".blk[data-blk=tree]").offsetParent, right: !document.getElementById("infoPane").hidden }));
    check(!st.img && st.tree && !st.right, `${W}: ロット表では MAP などを出さず、右の欄も隠す（木は出る）`);
    await page.evaluate(() => document.querySelector('#modeBar [data-mode="grid"]').click()); await page.waitForTimeout(300);

    // 10. 開き直しても残る（境目の高さ・移した場所・たたんだ状態）
    // ロット情報をたたむ（低い窓では標準でたたんであるので、そのときは開いてから、開いた状態が残ることも確かめる）
    if (await page.evaluate(() => window.dtLayout.get().fold.lot)) { await page.click('.blk[data-blk="lot"] .bt'); await page.waitForTimeout(100); }
    await page.click('.blk[data-blk="lot"] .bt'); await page.waitForTimeout(100);
    const g2 = await box('.blk[data-blk="tree"] .grip'), img2 = await box('.blk[data-blk="img"]');
    await page.mouse.move(g2.x + 5, g2.y + 5); await page.mouse.down(); await page.mouse.move(img2.x + img2.w / 2, img2.y + 10, { steps: 10 }); await page.mouse.up();
    await page.waitForTimeout(200);
    // 並び順によらず中身で比べる（たたんだ物などの鍵を並べ替えてから文字にする）
    const canon = () => page.evaluate(() => { const L = window.dtLayout.get(); const sort = (o) => Object.fromEntries(Object.entries(o).sort());
      return JSON.stringify({ ...L, w: sort(L.w), fold: sort(L.fold), auto: sort(L.auto) }); });
    const saved = await canon();
    await reopen();
    const back = await canon();
    const L = JSON.parse(back);
    check(back === saved && L.place.right[0] === "tree" && L.fold.lot, `${W}: 開き直しても配置が残る（右の欄 ${L.place.right.join(",")}・ロット情報をたたんだまま）${back === saved ? "" : `／前 ${saved}／後 ${back}`}`);
    check(!errs.length, `${W}: 画面の誤りが出ない（${errs.join(" / ") || "なし"}）`);
    await page.context().close();
  }
} finally {
  await h.close();
}
console.log(bad ? `FAILED（${bad} 件）` : "OK（すべて）");
process.exit(bad ? 1 : 0);
