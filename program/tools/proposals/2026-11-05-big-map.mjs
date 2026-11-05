// 中央に MAP を大きく出す切り替えと、欠陥の位置に指を乗せると縮小画像を浮かせて出す（ポップオーバー）案（1 回目）:
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-11-05-big-map.mjs
//
// 利用者の依頼: 「メインの表示の場所に画像 MAP を大きく出せる切り替え」「欠陥の位置にカーソルがあったら縮小画像をポップオーバーで出す」
// 今の困りごと（今の画面を撮った画像で見えたこと）:
//  - MAP は右の欄のブロック（lot-1728 で 約 360×340px・lot-1280 で 約 340×150px）。58 件の点が表・裏の 2 本の細い帯に詰まり、
//    1280 では帯の高さが 150px ほどで、点が重なって読めない
//  - 点がどの画像か分かるのは、押して一覧で選ばれたカードを探してから（指を乗せても何も出ない）
// 案の方向: 置き場（A: 見方の段にタブ・C: 中央を一覧と MAP に分ける・E: 窓で重ねる）・入口（B: タブ＋右の MAP の見出しからも・F: 帯の右の 1 つのボタン）・
//   見せ方（D: 浮かせる札に、近くの欠陥も並べる）
// 撮り方: 本物の MAP（#map）をいったん大きな置き場へ移して大きく描かせ、その絵を写してから元へ戻す（作るときは同じ描き方を 2 つの canvas に使う）。
//   浮かせる札は、写した絵の中の「穴」（赤）の点を探してその横に出す（縮小画像は一覧の 1 枚目〈欠陥No:1 穴〉を使う）。

const POP_CSS = `.mpop{position:fixed;z-index:60;background:var(--pane);border:1px solid #9fb3cc;border-radius:8px;box-shadow:0 8px 24px rgba(15,30,60,.25);padding:8px;display:flex;flex-direction:column;gap:6px;pointer-events:none;font-size:12.5px}
.mpop img{display:block;width:200px;height:150px;object-fit:contain;background:#222;image-rendering:pixelated;border-radius:4px}
.mpop .h{display:flex;align-items:center;gap:6px;font-weight:700}.mpop .h .face{font-size:11px}
.mpop .r{display:flex;justify-content:space-between;gap:12px}.mpop .r b{font:400 12px Consolas,monospace}
.mpop .k{color:var(--sub);font-size:11.5px;border-top:1px solid var(--line2);padding-top:5px}
.mring{position:fixed;z-index:59;width:22px;height:22px;border:2px solid var(--acc);border-radius:50%;pointer-events:none;box-shadow:0 0 0 2px #fff}`;
const BIG_CSS = `.bigmap{flex:1;min-height:0;display:flex;flex-direction:column;background:var(--pane);margin:6px 10px 8px;border:1px solid var(--line);border-radius:6px;padding:8px 10px;gap:6px}
.bigmap .bm-cv{flex:1;min-height:0;position:relative}.bigmap .bm-cv>canvas{position:absolute;inset:0;width:100%;height:100%}
.bigmap .legend{font-size:12.5px}`;

// 浮かせる札の中身（rich: 近くの欠陥も並べる）
const POP_HTML = (rich) => `'<div class="mpop" id="mpop"><div class="h">欠陥No:1 穴 <span style="color:#d32f2f">●</span> <span class="face" style="background:#1e5aa8">裏面</span></div>' +
  '<img src="' + src + '">' +
  '<div class="r"><span>幅方向OS～(mm)</span><b>675.61</b></div><div class="r"><span>長さ方向(m)</span><b>2100.78</b></div>' +
  ${rich ? `'<div class="k" style="color:var(--txt);font-weight:600">近くにほかに 2 件</div><div style="display:flex;gap:6px">' + [1,2].map(() => '<img src="' + src2 + '" style="width:96px;height:72px">').join("") + '</div>' +` : ""}
  '<div class="k">押す＝一覧で選ぶ・ダブルクリック＝拡大</div></div>'`;

// 大きな MAP を置き場（host）に描き、浮かせる札を出す
const BIG = (host, rich = false) => `return (async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const host = document.querySelector(${JSON.stringify(host)}); const cv = document.getElementById("map"); const back = document.getElementById("mapLegend");
  host.querySelector(".legend").innerHTML = back.innerHTML;
  const slot = host.querySelector(".bm-cv"); slot.append(cv); cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%"; await wait(500);
  const copy = document.createElement("canvas"); copy.width = cv.width; copy.height = cv.height; copy.getContext("2d").drawImage(cv, 0, 0);
  cv.style.cssText = ""; back.before(cv); slot.append(copy); await wait(400);
  const d = copy.getContext("2d").getImageData(0, 0, copy.width, copy.height).data; let hit = null;
  const red = (x, y) => { const i = (y * copy.width + x) * 4; return d[i] > 170 && d[i + 1] < 110 && d[i + 2] < 110 && d[i + 3] > 150; };
  const q = Math.round(2 * devicePixelRatio), top = Math.round(24 * devicePixelRatio);
  for (let y = top; y < copy.height - q && !hit; y++) for (let x = q; x < copy.width - q; x++) if (red(x, y) && red(x - q, y) && red(x + q, y) && red(x, y - q) && red(x, y + q)) { let t = 0; while (red(x, y + t)) t++; let a = 0, b = 0; while (red(x - a, y + t / 2 | 0)) a++; while (red(x + b, y + t / 2 | 0)) b++; hit = [x + (b - a) / 2, y + t / 2]; break; }
  const r = copy.getBoundingClientRect(), k = r.width / copy.width; const px = hit ? r.left + hit[0] * k : r.left + r.width / 2, py = hit ? r.top + hit[1] * k : r.top + r.height / 2;
  const imgs = [...document.querySelectorAll("#grid .th img")]; const src = imgs[0]?.src || "", src2 = imgs[1]?.src || src;
  document.body.insertAdjacentHTML("beforeend", '<div class="mring" style="left:' + (px - 11) + 'px;top:' + (py - 11) + 'px"></div>' + ${POP_HTML(rich)});
  const p = document.getElementById("mpop"), b = p.getBoundingClientRect();
  let L = px + 18, T = py - b.height / 2; if (L + b.width > innerWidth - 8) L = px - 18 - b.width; T = Math.max(8, Math.min(innerHeight - b.height - 8, T));
  p.style.left = L + "px"; p.style.top = T + "px"; })()`;

const HOST = (bar = "") => `<div class="bigmap" id="bigMap">${bar}<div class="bm-cv"></div><div class="legend"></div></div>`;
// 見方の段に「MAP」を足して選んだ形（一覧・列・画像表示を隠し、フィルタの帯は残す: 絞った欠陥だけを描く）
const TAB = [["insert", '<button type="button" data-v="map" class="on">◫ MAP</button>', "afterend", '#viewSeg [data-v="grid"]'],
  ["script", `document.querySelector('#viewSeg [data-v="grid"]').classList.remove("on"); document.getElementById("grid").hidden = true;
    document.getElementById("sizerWrap").style.display = "none"; document.querySelector(".cardzone").style.display = "none";`],
  ["insert", HOST(), "afterend", "#grid"]];

export const STATES = {};
export const PROPOSALS = [
  {
    key: "A", name: "見方の段にタブ「MAP」（画像一覧｜MAP｜転写候補｜ピッチ候補）・中央いっぱいに MAP",
    css: BIG_CSS + POP_CSS, ops: TAB, state: BIG("#bigMap"),
  },
  {
    key: "B", name: "A＋右の MAP の見出しに「⤢ 中央で大きく」（MAP のそばからも入れる。大きくしている間は右の MAP をたたむ）",
    css: BIG_CSS + POP_CSS + `.bm-go{border:1px solid #b7cbe6;background:var(--pane);color:var(--acc);border-radius:5px;padding:1px 8px;font-size:12px;white-space:nowrap}
.blk[data-blk="map"]>:not(.bh){display:none!important}.blk[data-blk="map"]{flex:0 0 auto!important;height:auto!important;min-height:0!important}`,
    ops: [...TAB, ["insert", '<button type="button" class="bm-go" title="中央に大きく出す">⤢ 中央で大きく</button>', "beforeend", '.blk[data-blk="map"] .bn']],
    state: BIG("#bigMap"),
  },
  {
    key: "C", name: "中央を左右に分ける切り替え「一覧＋MAP」（左に大きな MAP・右に画像一覧。並べて見る）",
    css: BIG_CSS + POP_CSS + `#center .split2{flex:1;min-height:0;display:flex}.split2>.bigmap{flex:0 0 46%;margin-right:0}.split2>#grid{flex:1;min-width:0}`,
    ops: [["insert", '<button type="button" data-v="split" class="on">◫ 一覧＋MAP</button>', "afterend", '#viewSeg [data-v="grid"]'],
      ["script", `document.querySelector('#viewSeg [data-v="grid"]').classList.remove("on"); const g = document.getElementById("grid"); const w = document.createElement("div"); w.className = "split2"; g.before(w);
        w.insertAdjacentHTML("afterbegin", ${JSON.stringify(HOST())}); w.append(g); if (window.dtCols) window.dtCols(2);`],
      ["script", `const b = document.querySelector('#colSeg [data-cols="2"]'); if (b) b.click();`]],
    state: BIG("#bigMap"),
  },
  {
    key: "D", name: "A＋浮かせる札に近くの欠陥も並べる（点が重なっていても、指した所の欠陥を全部見られる）",
    css: BIG_CSS + POP_CSS, ops: TAB, state: BIG("#bigMap", true),
  },
  {
    key: "E", name: "窓で重ねる（右の MAP の「⤢ 大きく」で画面の 92% の窓に MAP。Esc で閉じる）",
    css: BIG_CSS + POP_CSS + `.bm-ov{position:fixed;inset:0;z-index:50;background:rgba(15,25,40,.45);display:flex;align-items:center;justify-content:center}
.bm-ov>.bigmap{width:92vw;height:90vh;flex:none;margin:0;box-shadow:0 12px 40px rgba(0,0,0,.3)}
.bm-ov .bm-bar{display:flex;align-items:center;gap:8px;font-weight:700;color:var(--acc)}.bm-ov .bm-bar button{margin-left:auto}`,
    ops: [["insert", `<div class="bm-ov">${HOST('<div class="bm-bar">MAP（大きく） <span class="sub">58件（画像あり 9）</span><button type="button">閉じる（Esc）</button></div>')}</div>`, "beforeend", "body"]],
    state: BIG("#bigMap"),
  },
  {
    key: "F", name: "帯の右の 1 つのボタン「◫ MAP で見る ⇄ 画像で見る」で中央を入れ替える",
    css: BIG_CSS + POP_CSS + `.bm-tog{border:1px solid var(--acc);background:var(--acc);color:#fff;border-radius:5px;padding:3px 12px;font-size:12.5px;font-weight:700;white-space:nowrap}`,
    ops: [["insert", '<button type="button" class="bm-tog" title="中央を画像一覧に戻す">▣ 画像で見る</button>', "beforeend", "#center .toolbar"],
      ["script", `document.getElementById("grid").hidden = true; document.getElementById("sizerWrap").style.display = "none"; document.querySelector(".cardzone").style.display = "none";`],
      ["insert", HOST(), "afterend", "#grid"]],
    state: BIG("#bigMap"),
  },
];
// 案ごとの状態の文（ui-variants は状態ごとに全案を撮るので、案の鍵で分ける）
STATES.map = `const k = document.body.dataset.proposal; const S = ${JSON.stringify(Object.fromEntries(PROPOSALS.map((p) => [p.key, p.state])))}; return new Function(S[k])();`;
for (const p of PROPOSALS) p.ops = [...p.ops, ["script", `document.body.dataset.proposal = ${JSON.stringify(p.key)};`]];
