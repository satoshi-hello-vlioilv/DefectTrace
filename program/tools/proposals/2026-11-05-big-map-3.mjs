// 中央の大きな MAP と浮かせる札（3 回目・最後の回）。2 回目の 1 位 B2（76.6 点）に 2 回目の減点の直しを入れた形（B3）を本物で作り、その上に案を当てる:
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-11-05-big-map-3.mjs
//
// 2 回目の採点（2026-11-05-big-map.json の rounds[1]）で直した所（どの案にも入っている。app.js・style.css の本物）:
//  - 1280 で札が MAP の枠より高く、操作の段と凡例を覆った → 札が枠に収まるまで縮小画像を縮める（下限 72px）。操作の段の間を詰め 2 段に
//  - 中央の MAP で選んで一覧に戻ると、選んだカードが画面の外だった → 戻したら選んだカードまで一覧を送る
//  （「札の画像と選ばれた画像が別の CAB」は、本物で確かめると同じ画像〈0002/18.bmp〉だった。押す前の画像情報〈0000/0.bmp〉と比べた取り違え）
// 案の方向: B3（そのまま）・I3（流れ: 押すと札を留めて操作。2 回目の 2 位を持ち越し）・N1（見せ方: 横長の札）・
//   N2（状態: MAP の上に「選んだ欠陥」の帯）・N3（減らし方: 操作の段を「⚙ 表示 ▾」1 つに畳む）

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
  { key: "B3", name: "B3: B2＋札を枠に収める（画像を縮める）・操作 2 段・戻したら選んだカードへ送る（本物）", css: "", ops: [] },
  {
    key: "I3", name: "I3: B3＋点を押すと札をその場に留め、札の中に「← →」「一覧で見る」「拡大」",
    css: `.mpop.pin{pointer-events:auto;border-color:var(--acc);box-shadow:0 8px 24px rgba(15,30,60,.3),0 0 0 2px var(--accbg)}
.mpop .acts{display:flex;gap:6px;border-top:1px solid var(--line2);padding-top:6px}.mpop .acts button{font-size:12px;padding:2px 8px}.mpop .acts .primary{margin-left:auto}
.mpop .pinx{margin-left:6px;border:none;background:none;color:var(--sub);padding:0 2px}`,
    ops: [["script", `window.__after = async () => { const p = document.querySelector(".mpop"); p.classList.add("pin");
      p.querySelector(".k").outerHTML = '<div class="acts"><button type="button" title="前の欠陥">←</button><button type="button" title="次の欠陥">→</button><button type="button">一覧で見る</button><button type="button" class="primary">拡大</button></div>';
      p.querySelector(".h").insertAdjacentHTML("beforeend", '<button type="button" class="pinx" title="札を閉じる（Esc）">×</button>'); };`]],
  },
  {
    key: "N1", name: "N1: B3＋横長の札（画像の右に値を並べる。低い MAP でも画像を縮めずに収まる）",
    css: `.mpop{width:440px;display:grid;grid-template-columns:200px 1fr;column-gap:12px;row-gap:4px;align-content:start}
.mpop .h,.mpop .k{grid-column:1/-1}.mpop img,.mpop .noimg{grid-column:1;grid-row:2/span 4;width:200px;height:150px!important}
.mpop .r{grid-column:2;flex-direction:column;gap:0}.mpop .r b{font-size:13px;color:var(--txt)}`,
    ops: [],
  },
  {
    key: "N2", name: "N2: B3＋MAP の上に「選んだ欠陥」の帯（番号・分類・面・画像名と「⤢ 拡大」「▣ 一覧で見る」）",
    css: `.bm-sel{display:flex;align-items:center;gap:10px;border:1px solid #b7cbe6;background:var(--accbg);border-radius:5px;padding:4px 6px 4px 10px;font-size:12.5px;white-space:nowrap}
.bm-sel>.sub{font-size:12px}.bm-sel b{color:var(--acc)}.bm-sel .face{font-size:11px}.bm-sel button{font-size:12px;padding:1px 9px}.bm-sel .first{margin-left:auto}`,
    ops: [["insert", '<div class="bm-sel"><span class="sub">選んだ欠陥</span><b>欠陥No:1 穴</b><span style="color:#d32f2f">●</span><span class="face" style="background:#1e5aa8">裏面</span><span class="sub" style="font-family:Consolas,monospace">0002/18.bmp</span><button type="button" class="first">⤢ 拡大</button><button type="button">▣ 一覧で見る</button></div>', "beforebegin", "#mapBig"]],
  },
  {
    key: "N3", name: "N3: B3＋操作の段を「⚙ 表示 ▾」1 つに畳む（面の切り替えだけ出す。MAP の面を最大に）",
    css: `.bm-ctl .mkbar,.bm-ctl .slots{display:none!important}.bm-more{order:9;margin-left:auto;border:1px solid #b7cbe6;background:var(--pane);color:var(--acc);border-radius:5px;padding:3px 10px;font-size:12.5px;white-space:nowrap}`,
    ops: [["insert", '<button type="button" class="bm-more" title="記号の大きさ・濃さ・描き方・形と、横・縦の軸">⚙ 表示 ▾</button>', "beforeend", "#bigMapCtl"]],
  },
];
for (const p of PROPOSALS) p.ops = [...p.ops, ["script", `document.body.dataset.proposal = ${JSON.stringify(p.key)};`]];
STATES.map = SHOW();
