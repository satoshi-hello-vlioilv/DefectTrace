// フィルタを作る窓（#fModal）を大きく・使いやすくする案（1 回目）:
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-11-02-filter-win.mjs
//
// 今の困りごと（今の画面を撮った画像で見えたこと）:
//  - 窓は上から 80px 下げた所に出て、高さは中身なり（1536×864 で約 490px）。下の 1/3 は暗い背景のまま空いている
//  - 作る所の入れ物が小さい（名前 240px・値 80px）。分布は高さ 46px で、どこが当てはまるか読みにくい
//  - 当てはまる画像の見本は 64×48px で 8 枚まで。絞った結果を見て確かめる所が小さい
//  - 左の「登録した条件」は条件が無いと説明 2 行だけで、幅 340px が空く
// 案の方向: 大きさ（P: 窓を広げる・T: 窓の大きさを利用者が変える）・置き場（Q: 3 列・R: 上下）・流れ（S: 一覧そのものを見本にする引き出し）・見せ方（U: 分布を主役にして範囲をドラッグ）

const OPEN = `return (async () => { document.getElementById("fOpen").click(); await new Promise((r) => setTimeout(r, 900));
  const v = document.querySelector('#fEd input[data-k="v"]'); if (v) { v.value = "2"; v.dispatchEvent(new Event("input", { bubbles: true })); }
  document.getElementById("fName").value = "長い欠陥"; await new Promise((r) => setTimeout(r, 1500)); if (window.__fx) window.__fx(); await new Promise((r) => setTimeout(r, 300)); })()`;
export const STATES = { filter: OPEN };

// 見本の画像を足して並べる（試験のロットは当てはまる画像が少ないので、同じ画像を繰り返して格子の見え方を確かめる）
const MORE = (n) => `window.__fx = () => { const p = document.getElementById("fPrev"); const imgs = [...p.querySelectorAll("img")]; if (!imgs.length) return;
  p.innerHTML = ""; for (let i = 0; i < ${n}; i++) { const f = document.createElement("figure"); f.className = "f-pv"; const im = imgs[i % imgs.length].cloneNode(); f.append(im); f.insertAdjacentHTML("beforeend", '<figcaption>000' + (i % 4) + '/' + i + '.bmp</figcaption>'); p.append(f); } if (window.__fx2) window.__fx2(); };`;
const PV = `.f-pv{margin:0;display:flex;flex-direction:column;gap:2px;font:11.5px Consolas,monospace;color:var(--sub)}.f-pv img{width:100%!important;height:auto!important;aspect-ratio:4/3;object-fit:cover}`;
const BIG = `#fModal{padding-top:0;align-items:center}
.f-win{width:min(1600px,94vw)!important;height:min(940px,90vh);max-height:none!important}
.f-body{flex:1;min-height:0}
.f-ed{font-size:14px;gap:12px}.f-ed h4{font-size:15px}.f-ed input[type=text],.f-ed input[type=number],.f-ed select{font-size:14px;padding:4px 8px}
#fName{width:360px!important}.f-ed input[type=number]{width:120px!important}
.f-k{width:56px;font-size:13px}
.f-rows>.f-r{flex-wrap:nowrap}.f-ed select{max-width:230px}`;

export const PROPOSALS = [
  {
    key: "P", name: "窓を広げる（画面の 94%×90%）・2 列のまま入れ物と見本を大きく",
    css: BIG + PV + `.f-hist{height:110px;max-width:none}.f-prev{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;overflow:auto;flex:1}`,
    ops: [["script", MORE(16)]],
  },
  {
    key: "Q", name: "3 列（登録した条件｜作る｜当てはまる画像の見本）",
    css: BIG + PV + `.f-body{grid-template-columns:260px minmax(470px,1fr) minmax(340px,1.1fr)}
.f-hist{height:120px;max-width:none}
.f-res{border-left:1px solid var(--line);padding:12px 14px;display:flex;flex-direction:column;gap:8px;min-height:0;overflow:hidden;background:#fbfcfe}
.f-res>h4{margin:0;font-size:14px;color:var(--acc)}
.f-res .f-prev{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;overflow:auto;flex:1;align-content:start}
.f-res .f-n{font-size:14px}`,
    ops: [["insert", '<div class="f-res" id="fRes"></div>', "beforeend", ".f-body"], ["script", MORE(18)],
      ["script", `window.__fx2 = () => { const r = document.getElementById("fRes"); r.append(document.getElementById("fLive").parentElement, document.getElementById("fPrev")); };`]],
  },
  {
    key: "R", name: "上下（上に登録と作る所・下いっぱいに見本）",
    css: BIG + PV + `.f-body{display:grid;grid-template-columns:300px minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)}
.f-lib{grid-row:1/3}.f-ed{overflow:visible}
.f-hist{height:70px;max-width:none}
.f-bot{border-top:1px solid var(--line);padding:10px 14px;display:flex;flex-direction:column;gap:8px;min-height:0;overflow:hidden}
.f-bot .f-prev{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;overflow:auto;flex:1;align-content:start}`,
    ops: [["insert", '<div class="f-bot" id="fBot"></div>', "beforeend", ".f-body"], ["script", MORE(24)],
      ["script", `window.__fx2 = () => { document.getElementById("fBot").append(document.getElementById("fLive").parentElement, document.getElementById("fPrev")); };`]],
  },
  {
    key: "S", name: "右の引き出し（後ろの画像一覧がそのまま見本・絞られていく）",
    css: `#fModal{background:transparent;pointer-events:none;padding:0;justify-content:flex-end;align-items:stretch}
.f-win{pointer-events:auto;width:min(620px,44vw)!important;max-height:none!important;height:auto;margin:0;border-radius:0;box-shadow:-12px 0 30px rgba(0,0,0,.2);border-left:1px solid var(--line)}
.f-body{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr);flex:1}
.f-lib{border-right:none;border-bottom:1px solid var(--line);max-height:200px}
.f-ed{font-size:14px}.f-ed input[type=text],.f-ed input[type=number],.f-ed select{font-size:14px;padding:4px 8px}
.f-hist{height:90px;max-width:none}.f-prev{display:none}
#grid .th:nth-child(3n+2){opacity:.22}`,
    ops: [],
  },
  {
    key: "T", name: "大きさを利用者が変える窓（角をドラッグ・覚える）＋3 列",
    css: BIG + PV + `.f-win{resize:both;overflow:hidden;position:relative;min-width:900px;min-height:560px}
.f-win::after{content:"";position:absolute;right:3px;bottom:3px;width:14px;height:14px;background:linear-gradient(135deg,transparent 45%,#8a97a8 45% 52%,transparent 52% 65%,#8a97a8 65% 72%,transparent 72%);pointer-events:none}
.f-size{font-size:12px;color:var(--sub);display:flex;gap:6px;align-items:center}.f-size button{font-size:12px;padding:1px 8px}
.f-body{grid-template-columns:260px minmax(470px,1fr) minmax(320px,1fr)}
.f-hist{height:110px;max-width:none}
.f-res{border-left:1px solid var(--line);padding:12px 14px;display:flex;flex-direction:column;gap:8px;min-height:0;overflow:hidden}
.f-res>h4{margin:0;font-size:14px;color:var(--acc)}
.f-res .f-prev{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;overflow:auto;flex:1;align-content:start}`,
    ops: [["insert", '<span class="f-size">窓の大きさ <span class="seg"><button type="button">中</button><button type="button" class="on">大</button><button type="button">全画面</button></span></span>', "beforebegin", "#fClose"],
      ["insert", '<div class="f-res" id="fRes"></div>', "beforeend", ".f-body"], ["script", MORE(15)],
      ["script", `window.__fx2 = () => { document.getElementById("fRes").append(document.getElementById("fLive").parentElement, document.getElementById("fPrev")); };`]],
  },
  {
    key: "U", name: "分布が主役（大きな分布の上で範囲をドラッグして条件を決める）",
    css: BIG + PV + `.f-body{grid-template-columns:300px minmax(0,1fr)}
.f-hist{height:200px;max-width:none;position:relative;border:1px solid var(--line);border-radius:6px;padding:8px 8px 0}
.f-hist::after{content:"◀ ドラッグで範囲 ▶";position:absolute;left:40%;top:6px;font-size:12px;color:#fff;background:var(--acc);border-radius:4px;padding:1px 8px}
.f-prev{display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:8px;overflow:auto;max-height:240px}`,
    ops: [["script", MORE(14)]],
  },
];
