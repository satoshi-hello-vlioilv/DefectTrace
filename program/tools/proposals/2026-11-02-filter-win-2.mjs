// フィルタを作る窓の案（2 回目）。1 回目（2026-11-02-filter-win.mjs）は 1 位 T 76.3 点で 80 点に届かなかった:
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-11-02-filter-win-2.mjs
//
// 1 回目の採点で低かった所（2026-11-02-filter-win.json の rounds[0]）:
//  - T・Q: 1280 で「置き場」の名前だけ 1 段目・選ぶ所が 2 段目に折れる（−3）→ 置き場は見出しの下に選ぶ所を 1 行で（字を詰める）
//  - 作る所と左の列の下が大きく空く → 分布を空きへ大きく（高さ 200px 前後）・条件が無いときの左の列に「例から作る」
//  - 分布の上にいまの値（≥ 2）の位置が出ない → 値の所に縦の線と札・当てはまる側を薄く塗る
//  - 窓の大きさの切り替えが見出しの説明に埋もれる → × の左に独立して置き、説明は短く
// 効いた所（持ち越す）: 窓を画面の 94%×90%・3 列（登録｜作る｜当てはまる画像）・見本の数を見出しに・大きさを利用者が変える
// 案の方向: T2・Q2＝直した物（大きさを変えられる／決め打ち）・V＝作る所を ①②③ の順に（名前と置き場は保存の所へ）・
//   W＝条件を上の帯に文で並べ、下を分布と見本で 2 分・X＝分布の範囲を両端のつまみで決める（つまみが見える）＋左の列に「例から作る」

const OPEN = `return (async () => { document.getElementById("fOpen").click(); await new Promise((r) => setTimeout(r, 900));
  const v = document.querySelector('#fEd input[data-k="v"]'); if (v) { v.value = "2"; v.dispatchEvent(new Event("input", { bubbles: true })); }
  document.getElementById("fName").value = "長い欠陥"; await new Promise((r) => setTimeout(r, 1500)); if (window.__fx) window.__fx(); await new Promise((r) => setTimeout(r, 300)); })()`;
export const STATES = { filter: OPEN };

const MORE = (n) => `window.__fx = () => { const p = document.getElementById("fPrev"); const imgs = [...p.querySelectorAll("img")]; if (!imgs.length) return;
  p.innerHTML = ""; for (let i = 0; i < ${n}; i++) { const f = document.createElement("figure"); f.className = "f-pv"; const im = imgs[i % imgs.length].cloneNode(); f.append(im); f.insertAdjacentHTML("beforeend", '<figcaption>000' + (i % 4) + '/' + i + '.bmp</figcaption>'); p.append(f); }
  const h = document.getElementById("fHist"); if (h && !h.querySelector(".f-mark")) h.insertAdjacentHTML("beforeend", '<span class="f-shade" style="left:1%;right:0"></span><span class="f-mark" style="left:1%"><b>≥ 2</b></span>');
  if (window.__fx2) window.__fx2(); };`;
// 例から作る（条件が無いときの左の列）
const EXAMPLES = `<div class="f-exs"><b>例から作る</b><button type="button">長さ ≥ ○ mm（長い欠陥）</button><button type="button">面積 ≥ ○ mm²（大きい欠陥）</button><button type="button">分類 ＝ 穴・キズ（種類で）</button><button type="button">表面だけ・裏面だけ</button><button type="button">幅方向 OS ○〜○ mm（場所で）</button></div>`;
const PV = `.f-pv{margin:0;display:flex;flex-direction:column;gap:2px;font:11.5px Consolas,monospace;color:var(--sub)}.f-pv img{width:100%!important;height:auto!important;aspect-ratio:4/3;object-fit:cover}
.f-hist{position:relative;height:190px;max-width:none;border:1px solid var(--line);border-radius:6px;padding:8px 8px 0;background:#fbfcfe}
.f-shade{position:absolute;top:0;bottom:0;background:rgba(31,95,191,.08);pointer-events:none}
.f-mark{position:absolute;top:0;bottom:0;border-left:2px solid #c2410c}.f-mark b{position:absolute;top:4px;left:4px;font-size:12px;color:#fff;background:#c2410c;border-radius:4px;padding:0 6px;white-space:nowrap}
.f-exs{display:flex;flex-direction:column;gap:6px;margin-top:14px;padding-top:12px;border-top:1px solid var(--line)}.f-exs b{font-size:13px}
.f-exs button{text-align:left;border:1px solid #c9d6e8;background:var(--pane);border-radius:6px;padding:6px 10px;font-size:13px;color:var(--acc)}
.f-scope2{display:flex;flex-direction:column;gap:4px}.f-scope2 .f-k{width:auto}`;
const BIG = `#fModal{padding-top:0;align-items:center}
.f-win{width:min(1600px,94vw)!important;height:min(940px,90vh);max-height:none!important}
.mhead .sub{font-size:12.5px}
.f-body{flex:1;min-height:0}
.f-ed{font-size:14px;gap:12px}.f-ed h4{font-size:15px}.f-ed input[type=text],.f-ed input[type=number],.f-ed select{font-size:14px;padding:4px 8px}
#fName{width:100%!important;max-width:360px}.f-ed input[type=number]{width:110px!important}
.f-k{width:56px;font-size:13px}
.f-rows>.f-r{flex-wrap:nowrap}.f-ed select{max-width:220px}
.f-scope{gap:12px;flex-wrap:nowrap;font-size:13px}`;
const COL3 = `.f-body{grid-template-columns:270px minmax(460px,1fr) minmax(340px,1fr)}
.f-res{border-left:1px solid var(--line);padding:12px 14px;display:flex;flex-direction:column;gap:8px;min-height:0;overflow:hidden;background:#fbfcfe}
.f-res .f-prev{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;overflow:auto;flex:1;align-content:start}
.f-res .f-n{font-size:14px}`;
const SIZE = `.f-size{margin-left:auto;font-size:12.5px;color:var(--sub);display:flex;gap:6px;align-items:center;padding-right:10px}.f-size .seg button{font-size:12.5px;padding:2px 10px}
.mhead .sub{margin-left:12px}.mhead #fClose{margin-left:0}
.f-win{resize:both;overflow:hidden;position:relative;min-width:900px;min-height:560px}
.f-win::after{content:"";position:absolute;right:3px;bottom:3px;width:14px;height:14px;background:linear-gradient(135deg,transparent 45%,#8a97a8 45% 52%,transparent 52% 65%,#8a97a8 65% 72%,transparent 72%);pointer-events:none}`;
// 置き場を「見出し＋選ぶ所の 1 行」へ組み直す
const SCOPE = `const sc = document.querySelector(".f-scope"); if (sc) { const row = sc.closest(".f-r"); row.className = "f-scope2"; }`;
const RES = `document.getElementById("fRes").append(document.getElementById("fLive").parentElement, document.getElementById("fPrev"));`;
const LIBEX = `document.getElementById("fLib").insertAdjacentHTML("beforeend", ${JSON.stringify(EXAMPLES)});`;

export const PROPOSALS = [
  {
    key: "T2", name: "T を直した物（置き場を 1 行・大きな分布に値の線・例から作る・大きさは × の左）",
    css: BIG + PV + COL3 + SIZE,
    ops: [["insert", '<span class="f-size">窓の大きさ <span class="seg"><button type="button">中</button><button type="button" class="on">大</button><button type="button">全画面</button></span></span>', "beforebegin", "#fClose"],
      ["insert", '<div class="f-res" id="fRes"></div>', "beforeend", ".f-body"], ["script", MORE(15)],
      ["script", `window.__fx2 = () => { ${RES} ${SCOPE} ${LIBEX} };`]],
  },
  {
    key: "Q2", name: "Q を直した物（大きさは決め打ち・ほかは T2 と同じ）",
    css: BIG + PV + COL3,
    ops: [["insert", '<div class="f-res" id="fRes"></div>', "beforeend", ".f-body"], ["script", MORE(15)],
      ["script", `window.__fx2 = () => { ${RES} ${SCOPE} ${LIBEX} };`]],
  },
  {
    key: "V", name: "作る所を ①条件 ②確かめる（分布） ③名前と置き場で保存 の順に",
    css: BIG + PV + COL3 + `.f-step{display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px;color:var(--acc);margin-top:4px}.f-step i{font-style:normal;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:var(--acc);color:#fff;font-size:12.5px}
.f-save{margin-top:auto;border-top:1px solid var(--line);padding-top:10px;display:flex;flex-direction:column;gap:8px}`,
    ops: [["insert", '<div class="f-res" id="fRes"></div>', "beforeend", ".f-body"], ["script", MORE(15)],
      ["script", `window.__fx2 = () => { ${RES} ${SCOPE} ${LIBEX} const ed = document.getElementById("fEd");
        const nameRow = document.getElementById("fName").closest(".f-r"), scope = ed.querySelector(".f-scope2"), btns = ed.querySelector('[data-save]').closest(".f-r");
        ed.querySelector(".f-rows").insertAdjacentHTML("beforebegin", '<div class="f-step"><i>1</i>条件</div>'); document.getElementById("fHistT").insertAdjacentHTML("beforebegin", '<div class="f-step"><i>2</i>確かめる（分布と右の見本）</div>');
        const sv = document.createElement("div"); sv.className = "f-save"; sv.innerHTML = '<div class="f-step"><i>3</i>名前と置き場を決めて保存</div>'; sv.append(nameRow, scope, btns); ed.append(sv); };`]],
  },
  {
    key: "W", name: "上の帯に条件を文で並べ、下を分布｜見本に 2 分（登録は左の細い欄）",
    css: BIG + PV + `.f-body{grid-template-columns:250px minmax(0,1fr) minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)}
.f-lib{grid-row:1/3}.f-ed{grid-column:2/4;border-bottom:1px solid var(--line);flex-direction:row;flex-wrap:wrap;align-items:center;gap:10px 16px;overflow:visible}
.f-ed>.f-r:first-child{flex-basis:100%}.f-ed .f-hint#fHistT,.f-ed .f-hist{display:none}
.f-mid{padding:12px 14px;display:flex;flex-direction:column;gap:8px;min-height:0;border-right:1px solid var(--line)}.f-mid .f-hist{display:block!important;flex:1;height:auto;min-height:160px}.f-mid .f-hint{display:block!important}
.f-res{padding:12px 14px;display:flex;flex-direction:column;gap:8px;min-height:0;overflow:hidden;background:#fbfcfe}
.f-res .f-prev{display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:8px;overflow:auto;flex:1;align-content:start}`,
    ops: [["insert", '<div class="f-mid" id="fMid"></div><div class="f-res" id="fRes"></div>', "beforeend", ".f-body"], ["script", MORE(15)],
      ["script", `window.__fx2 = () => { ${RES} ${SCOPE} ${LIBEX} const m = document.getElementById("fMid"); m.append(document.getElementById("fHistT"), document.getElementById("fHist")); };`]],
  },
  {
    key: "X", name: "分布の範囲を両端のつまみで決める（つまみ・値の札が見える）＋3 列",
    css: BIG + PV + COL3 + `.f-hist{height:210px}
.f-knob{position:absolute;bottom:-9px;width:16px;height:22px;margin-left:-8px;background:#fff;border:2px solid #c2410c;border-radius:4px;cursor:ew-resize}
.f-knob::after{content:"";position:absolute;left:4px;top:4px;width:4px;height:10px;border-left:1px solid #c2410c;border-right:1px solid #c2410c}
.f-hhint{font-size:12px;color:var(--sub)}`,
    ops: [["insert", '<div class="f-res" id="fRes"></div>', "beforeend", ".f-body"], ["script", MORE(15)],
      ["script", `window.__fx2 = () => { ${RES} ${SCOPE} ${LIBEX} const h = document.getElementById("fHist"); h.insertAdjacentHTML("beforeend", '<span class="f-mark" style="left:99%"><b style="left:auto;right:4px">≤ 500</b></span><span class="f-knob" style="left:1%"></span><span class="f-knob" style="left:99%"></span>');
        h.insertAdjacentHTML("afterend", '<div class="f-hhint">両端のつまみをドラッグすると、下の値が変わり、右の見本が絞られます</div>'); };`]],
  },
];
