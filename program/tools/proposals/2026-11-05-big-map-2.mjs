// 中央の大きな MAP と浮かせる札（2 回目）。1 回目の 1 位 B に採点の指摘を全部入れた形（B2）を本物で作り、その上に案を当てて比べる:
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-11-05-big-map-2.mjs
//
// 1 回目の採点（2026-11-05-big-map.json。1 位 B 69.8 点）で直した所（どの案にも入っている。app.js・layout-view.js・style.css の本物）:
//  - 札を MAP の枠の中に収める（枠が札より狭い・低いときは本体の領域の中。右の欄の小さな MAP は、MAP を覆わないよう枠の外の左へ）
//  - 大きな MAP の上に、右の MAP の操作（面・大きさ・濃さ・描き方・形・横縦の軸）を移して置く（1 か所にだけ。戻すと右へ帰る）
//  - 軸の数を 12px・本文の書体に（Consolas の無い PC で明朝に落ちていた）。横軸の目盛りを足す
//  - 自動のとき、記号を面の広さに合わせて大きくする（1〜2.2 倍）
//  - 見出しのボタンを状態で変える（⤢ 中央で大きく ⇄ ⤡ 右へ戻す）。右の MAP は貸し出し中としてたたんで見せる（利用者の配置は変えない）
//  - 押したときの行き先: 画像情報に出す（札の言葉も「押す＝画像情報へ」）。札の中身は一覧のカードと同じ（画像表示の項目と値）
// 案の方向: B2（そのまま）・K（見せ方: 札に近くの欠陥を短く）・G（結び付け: 下に画像の帯）・I（流れ: 押すと札を留めて操作を出す）・
//   H（入口: 見出しのボタンだけ・見方の段に状態の札）

// 中央の MAP を出し、赤い記号（穴）を探して指を乗せる（本物の札を出す）
const SHOW = (open = `document.querySelector('#viewSeg [data-v="map"]').click();`) => `return (async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  ${open} await wait(700);
  const cv = document.getElementById("mapBig"), c = cv.getContext("2d"), d = c.getImageData(0, 0, cv.width, cv.height).data, W = cv.width;
  const red = (x, y) => { const i = (y * W + x) * 4; return d[i] > 170 && d[i + 1] < 110 && d[i + 2] < 110 && d[i + 3] > 150; };
  const q = 3, r = cv.getBoundingClientRect(), k = r.width / W; let pt = null;
  for (let y = 30; y < cv.height - q && !pt; y++) for (let x = q; x < W - q; x++) if (red(x, y) && red(x - q, y) && red(x + q, y) && red(x, y - q) && red(x, y + q)) { let t = 0; while (red(x, y + t)) t++; pt = [r.left + x * k, r.top + (y + t / 2) * k]; break; }
  if (pt) cv.dispatchEvent(new PointerEvent("pointermove", { clientX: pt[0], clientY: pt[1], bubbles: true }));
  await wait(600); window.__pt = pt; if (window.__after) await window.__after(); await wait(300); })()`;

export const STATES = {};
export const PROPOSALS = [
  { key: "B2", name: "B2: タブ「◫ MAP」＋右の MAP の見出し「⤢ 中央で大きく」（1 回目の B に指摘を全部入れた本物）", css: "", ops: [] },
  {
    key: "K", name: "K: B2＋札に近くの欠陥を短く（番号・分類・面の札。点が重なっていても指した所の欠陥が分かる）",
    css: `.mpop .near{display:flex;flex-direction:column;gap:3px;border-top:1px solid var(--line2);padding-top:5px}.mpop .near>b{font-size:11.5px;color:var(--sub);font-weight:600}
.mpop .near span{display:flex;align-items:center;gap:6px;font-size:12px}.mpop .near .face{font-size:11px}`,
    ops: [["script", `window.__after = async () => { const k = document.querySelector(".mpop .k");
      k.insertAdjacentHTML("beforebegin", '<div class="near"><b>近くにほかに 2 件</b><span>欠陥No:22 汚れ <span style="color:#1e6fd9">▲</span><span class="face" style="background:#1e5aa8">裏面</span></span><span>欠陥No:43 キズ <span style="color:#2e9d4a">■</span><span class="face" style="background:#c62828">表面</span></span></div>'); };`]],
  },
  {
    key: "G", name: "G: B2＋MAP の下に画像のある欠陥の縮小画像の帯（帯に指を乗せると MAP の点に輪・点に指を乗せると帯の画像が光る）",
    css: `.bm-film{display:flex;gap:6px;overflow-x:auto;flex:none;padding:2px 0 4px}.bm-film figure{margin:0;flex:none;display:flex;flex-direction:column;gap:2px;font-size:11.5px;color:var(--sub);border:2px solid transparent;border-radius:4px;padding:2px}
.bm-film img{width:84px;height:63px;object-fit:contain;background:#222;image-rendering:pixelated;display:block}.bm-film figure.on{border-color:var(--acc);background:var(--accbg);color:var(--acc);font-weight:700}`,
    ops: [["script", `const imgs = [...document.querySelectorAll("#grid .th")].slice(0, 9); const f = document.createElement("div"); f.className = "bm-film";
      f.innerHTML = imgs.map((t, i) => '<figure' + (i === 0 ? ' class="on"' : '') + '><img src="' + t.querySelector("img").src + '"><figcaption>' + t.querySelector("legend").textContent + '</figcaption></figure>').join("");
      document.getElementById("mapBigLegend").after(f);`]],
  },
  {
    key: "I", name: "I: B2＋点を押すと札をその場に留め、札の中に「拡大」「一覧で見る」「← →」（指を離しても札が残る）",
    css: `.mpop.pin{pointer-events:auto;border-color:var(--acc);box-shadow:0 8px 24px rgba(15,30,60,.3),0 0 0 2px var(--accbg)}
.mpop .acts{display:flex;gap:6px;border-top:1px solid var(--line2);padding-top:6px}.mpop .acts button{font-size:12px;padding:2px 8px}.mpop .acts .primary{margin-left:auto}
.mpop .pinx{margin-left:6px;border:none;background:none;color:var(--sub);padding:0 2px}`,
    ops: [["script", `window.__after = async () => { const p = document.querySelector(".mpop"); p.classList.add("pin");
      p.querySelector(".k").outerHTML = '<div class="acts"><button type="button" title="前の欠陥">←</button><button type="button" title="次の欠陥">→</button><button type="button">一覧で見る</button><button type="button" class="primary">拡大</button></div>';
      p.querySelector(".h").insertAdjacentHTML("beforeend", '<button type="button" class="pinx" title="札を閉じる（Esc）">×</button>'); };`]],
  },
  {
    key: "H", name: "H: 入口は右の MAP の見出し「⤢ 中央で大きく」だけ・見方の段には「◫ MAP 表示中 ⤡ 戻す」の札",
    css: `#viewSeg [data-v="map"]{display:none}.bm-state{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--acc);background:var(--accbg);color:var(--acc);border-radius:5px;padding:3px 4px 3px 10px;font-size:12.5px;font-weight:700;white-space:nowrap}
.bm-state button{font-size:12px;padding:1px 8px;font-weight:400}`,
    ops: [["script", `window.__open = () => { document.getElementById("mapBigBtn").click(); document.querySelectorAll("#viewSeg button").forEach((b) => b.classList.remove("on"));
      document.getElementById("viewSeg").insertAdjacentHTML("afterend", '<span class="bm-state">◫ MAP 表示中 <button type="button" title="中央の MAP をしまい、画像一覧に戻す">⤡ 戻す</button></span>'); };`]],
  },
];
for (const p of PROPOSALS) p.ops = [...p.ops, ["script", `document.body.dataset.proposal = ${JSON.stringify(p.key)};`]];
STATES.map = SHOW(`(window.__open || (() => document.querySelector('#viewSeg [data-v="map"]').click()))();`);
