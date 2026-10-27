// MAP の欠陥の記号の案（1 回目）。欠陥の多いロットで撮る:
//   DT_UI_MORE='[{"name":"RB","path":"<本物のロットの束>/LS3"}]' DT_UI_LOT=<7016 点のロット> \
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-10-27-map-marks.mjs
//
// 今の困りごと（ui-check.mjs で 7,016 点のロットを撮った lot-1728 を見て）:
//  1. 記号が 11px の字（●）で、7,016 点が重なって灰色の塊になる。どこに欠陥が集まっているか（密集の濃さ）が分からない
//  2. 大きさは 6〜28px だけ（極小にできない）。重なりを見るための半透明・輪郭だけ、が無い
//  3. 記号の大きさのつまみ（「記号」）は、何が変わるのか（大きさ）が字に出ない
// 案の方向: 既定（小さな点・半透明）／変え方（段の部品・小窓・凡例・自動）／見せ方（濃さで密集・輪郭で重なり）
// 描き方は app.js の drawMarks（大きさ 1〜28px・濃さ・形〈字・点〉・塗り／輪郭／両方）。案ごとに既定と部品が違う

const set = (o) => ["script", `window.dtSetMark(${JSON.stringify(o)});`];
const bar = (html) => ["script", `document.querySelector(".mapbar").querySelector("label.fld").outerHTML = ${JSON.stringify(html)};`];
const BASE = `
.mk-seg{display:inline-flex;border:1px solid var(--line);border-radius:5px;overflow:hidden}
.mk-seg button{border:none;border-right:1px solid var(--line);border-radius:0;background:var(--pane);padding:2px 8px;font-size:12px;color:var(--txt)}
.mk-seg button:last-child{border-right:none}.mk-seg button.on{background:var(--acc);color:#fff}
.mk-fld{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--sub)}
.mk-fld input[type=range]{width:90px}
.mapbar{flex-wrap:wrap;row-gap:6px}`;

export const STATES = { lot: "" };

export const PROPOSALS = [
  {
    key: "M1", name: "既定は小さな半透明の点（3px・35%）＋MAP の段に 大きさ（1〜28px）と 見え方（塗り・輪郭・両方）",
    css: BASE,
    ops: [set({ size: 3, alpha: 0.35, shape: "dot", look: "fill" }),
      bar(`<span class="mk-fld" title="記号の大きさ（1〜28px）">大きさ <input type="range" min="1" max="28" value="3"><b>3px</b></span>
<span class="mk-fld" title="重なりを見るときは半透明・輪郭">濃さ <input type="range" min="5" max="100" value="35"><b>35%</b></span>
<span class="mk-seg" title="記号の描き方"><button class="on">塗り</button><button>輪郭</button><button>両方</button></span>`)],
  },
  {
    key: "M2", name: "「記号 ▾」の小窓に 大きさ・濃さ・形（字／点）・塗り／輪郭 と見本（既定 4px・50%・点）",
    css: BASE + `
.mapbar{position:relative}.mk-pop{position:absolute;right:0;top:calc(100% + 4px);z-index:20;background:var(--pane);border:1px solid var(--line);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:10px 12px;display:grid;grid-template-columns:auto 1fr;gap:8px 10px;font-size:12.5px;width:270px;align-items:center}
.mk-pop .lab{color:var(--sub)}.mk-prev{grid-column:1/3;display:flex;gap:14px;align-items:center;border-top:1px solid var(--line2);padding-top:8px}
.mk-prev i{display:inline-block;border-radius:50%}
.mk-open{border:1px solid var(--line);background:var(--pane);border-radius:5px;padding:2px 10px;font-size:12px}`,
    ops: [set({ size: 4, alpha: 0.5, shape: "dot", look: "fill" }),
      bar(`<button class="mk-open">記号 ● 4px・50% ▾</button>
<div class="mk-pop"><span class="lab">大きさ</span><span class="mk-fld"><input type="range" min="1" max="28" value="4"><b>4px</b></span>
<span class="lab">濃さ</span><span class="mk-fld"><input type="range" min="5" max="100" value="50"><b>50%</b></span>
<span class="lab">形</span><span class="mk-seg"><button class="on">点</button><button>分類の記号</button></span>
<span class="lab">描き方</span><span class="mk-seg"><button class="on">塗り</button><button>輪郭</button><button>両方</button></span>
<div class="mk-prev"><span class="lab">見本</span><i style="width:4px;height:4px;background:rgba(0,0,0,.5)"></i><i style="width:4px;height:4px;background:rgba(255,0,0,.5)"></i><span class="x-sub" style="color:var(--sub)">重なるほど濃く見えます</span></div></div>`)],
  },
  {
    key: "M3", name: "段の部品だけ: 大きさ（極小 2・小 4・中 8・大 14）× 見え方（濃い・半透明・輪郭）。既定 小・半透明",
    css: BASE,
    ops: [set({ size: 4, alpha: 0.4, shape: "dot", look: "fill" }),
      bar(`<span class="mk-fld">大きさ <span class="mk-seg"><button>極小</button><button class="on">小</button><button>中</button><button>大</button></span></span>
<span class="mk-fld">見え方 <span class="mk-seg"><button>濃い</button><button class="on">半透明</button><button>輪郭</button></span></span>`)],
  },
  {
    key: "M4", name: "密集が分かる濃さの目盛り: 極小の点（2px・15%）を重ねて濃さで数を見せ、凡例に「薄い＝少ない／濃い＝多い」",
    css: BASE + `.mk-scale{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--sub)}
.mk-scale i{display:inline-block;width:70px;height:10px;border-radius:2px;background:linear-gradient(90deg,rgba(0,0,0,.08),rgba(0,0,0,.9))}`,
    ops: [set({ size: 2, alpha: 0.15, shape: "dot", look: "fill" }),
      bar(`<span class="mk-fld">大きさ <input type="range" min="1" max="28" value="2"><b>2px</b></span>
<span class="mk-fld">濃さ <input type="range" min="5" max="100" value="15"><b>15%</b></span>
<span class="mk-scale" title="点を半透明で重ねるので、集まっている所ほど濃く見えます">少ない <i></i> 多い</span>`)],
  },
  {
    key: "M5", name: "凡例で分類ごとに（押すと 塗り→輪郭→隠す）＋大きさのつまみ（既定 4px・50%）",
    css: BASE + `#mapLegend span.mk-k{border:1px solid var(--line);border-radius:10px;padding:0 8px;cursor:pointer}
#mapLegend span.mk-k.line b{color:transparent!important;-webkit-text-stroke:1px currentColor}`,
    ops: [set({ size: 4, alpha: 0.5, shape: "dot", look: "fill" }),
      bar(`<span class="mk-fld">大きさ <input type="range" min="1" max="28" value="4"><b>4px</b></span>
<span class="mk-fld">濃さ <input type="range" min="5" max="100" value="50"><b>50%</b></span>`),
      ["script", `setTimeout(() => { document.querySelectorAll("#mapLegend span").forEach((s, i) => { if (i < 2) s.classList.add("mk-k"); });
        const n = document.createElement("span"); n.className = "x"; n.style.color = "var(--sub)"; n.textContent = "凡例を押すと 塗り→輪郭→隠す"; document.getElementById("mapLegend").append(n); }, 50);`]],
  },
  {
    key: "M6", name: "自動（点の数で大きさと濃さを決める: 58 点 → 7px・85%、7,016 点 → 2px・30%）＋「自動」を外すと手で",
    css: BASE,
    ops: [["script", `const n = parseInt(document.getElementById("mapTitle").textContent) || 0;
        const a = n < 300 ? { size: 7, alpha: 0.85 } : n < 2000 ? { size: 4, alpha: 0.5 } : { size: 2, alpha: 0.3 };
        window.dtSetMark({ ...a, shape: "dot", look: "fill" });
        document.querySelector(".mapbar").querySelector("label.fld").outerHTML = '<label class="mk-fld"><input type="checkbox" checked> 自動（点の数に合わせる）</label>'
          + '<span class="mk-fld" style="opacity:.55">大きさ <input type="range" min="1" max="28" value="' + a.size + '" disabled><b>' + a.size + 'px</b></span>'
          + '<span class="mk-fld" style="opacity:.55">濃さ <input type="range" min="5" max="100" value="' + a.alpha * 100 + '" disabled><b>' + Math.round(a.alpha * 100) + '%</b></span>'
          + '<span class="mk-seg"><button class="on">塗り</button><button>輪郭</button></span>';`]],
  },
];
