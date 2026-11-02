// 拡大画像の計測の案（2 回目）。1 回目（2026-11-02-measure.mjs）は 6 案とも 80 点に届かなかった（1 位 C 71.7）:
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-11-02-measure-2.mjs
//
// 1 回目の採点で低かった所（2026-11-02-measure.json）:
//  - 全案: 札が欠陥の右上に被り、欠陥の縁を隠す（重なり）→ 札を欠陥から離す（線の端の外・読み取り欄・引き出し線）
//  - モードを入れる 1 手（A・C・D・E）→ モード無し（ドラッグ＝測る）。操作の説明は画面に出す（F は出ていなかった）
//  - 物差しの出どころが見えない（B・D）・推定が確かな値に見える（E）→ どの案も物差しと出どころ（推定・件数／合わせた値）を出す
//  - F の「合わせる…」が読みにくい（11px・コントラスト 2.4）→ 読める色と大きさ
//  - 結果の一覧が無い（F）→ 右の欄に計測の一覧
// 効いた所（持ち越す）: 欠陥データと同じ言葉（幅・長さ）で比べる（C）・モード無し（B・F）・横と縦の物差しの違いを見せる（E・F）
// 案の方向: 読みの置き場（線の端の外・読み取り欄・帯・引き出し線）× 測る形（線が主・枠が主）

const LIB = ["script", `
window.__ov = () => { const st = document.getElementById("vStage"); st.style.position = "relative";
  let o = document.getElementById("mOv"); if (!o) { o = document.createElement("div"); o.id = "mOv"; st.append(o); }
  const im = document.getElementById("vImg").getBoundingClientRect(), sr = st.getBoundingClientRect();
  Object.assign(o.style, { position: "absolute", left: (im.left - sr.left) + "px", top: (im.top - sr.top) + "px", width: im.width + "px", height: im.height + "px", pointerEvents: "none" });
  return { o, w: im.width, h: im.height }; };
// 線（rect なら枠）と端の印。label は at（画像の中の割合）に置く。lead なら端から札まで引き出し線
window.__line = (a, b, label, opt = {}) => { const { o, w, h } = window.__ov();
  const [x0, y0, x1, y1] = [a[0] * w, a[1] * h, b[0] * w, b[1] * h], c = "#ffd23f";
  let s = '<svg width="' + w + '" height="' + h + '" style="position:absolute;inset:0;overflow:visible">';
  if (opt.parts) s += '<path d="M' + x0 + ' ' + y0 + 'H' + x1 + 'V' + y1 + '" fill="none" stroke="' + c + '" stroke-width="1.5" stroke-dasharray="5 4" opacity=".8"/>';
  if (opt.rect) s += '<rect x="' + Math.min(x0, x1) + '" y="' + Math.min(y0, y1) + '" width="' + Math.abs(x1 - x0) + '" height="' + Math.abs(y1 - y0) + '" fill="none" stroke="#111" stroke-width="5" opacity=".5"/><rect x="' + Math.min(x0, x1) + '" y="' + Math.min(y0, y1) + '" width="' + Math.abs(x1 - x0) + '" height="' + Math.abs(y1 - y0) + '" fill="none" stroke="' + c + '" stroke-width="2.5"/>';
  else s += '<line x1="' + x0 + '" y1="' + y0 + '" x2="' + x1 + '" y2="' + y1 + '" stroke="#111" stroke-width="5" opacity=".55"/><line x1="' + x0 + '" y1="' + y0 + '" x2="' + x1 + '" y2="' + y1 + '" stroke="' + c + '" stroke-width="2.5"/>';
  for (const [x, y] of [[x0, y0], [x1, y1]]) s += '<circle cx="' + x + '" cy="' + y + '" r="6" fill="#111" stroke="' + c + '" stroke-width="2.5"/>';
  if (opt.at && opt.lead) s += '<polyline points="' + x1 + ',' + y1 + ' ' + (opt.at[0] * w) + ',' + (opt.at[1] * h) + '" fill="none" stroke="' + c + '" stroke-width="1.5"/>';
  s += '</svg>';
  if (label) s += '<div class="mlab" style="position:absolute;left:' + (opt.at ? opt.at[0] * w : x1 + 14) + 'px;top:' + (opt.at ? opt.at[1] * h : y1 + 14) + 'px">' + label + '</div>';
  o.insertAdjacentHTML("beforeend", s);
  // 札が画像の右端・下端から出るなら、線の端の反対側へ回す（作るときも同じ）
  const lab = o.querySelector(".mlab:last-of-type");
  if (lab && !opt.at) { if (lab.offsetLeft + lab.offsetWidth > w) lab.style.left = (x1 - 14 - lab.offsetWidth) + "px"; if (lab.offsetTop + lab.offsetHeight > h) lab.style.top = (y1 - 14 - lab.offsetHeight) + "px"; }
  if (lab && opt.at && lab.offsetLeft + lab.offsetWidth > w) lab.style.left = (w - lab.offsetWidth - 8) + "px"; };
`];
const OPEN = `return (async () => {
  const th = document.querySelector("#grid .th"); th.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 700)); if (window.__draw) window.__draw();
})()`;
export const STATES = { measure: OPEN };

const BASE = `.mlab{background:rgba(17,19,23,.9);color:#fff;border:1px solid #ffd23f;border-radius:6px;padding:4px 9px;font:600 14px/1.35 Consolas,monospace;white-space:nowrap}
.mlab small{display:block;font:500 12px/1.35 Consolas,monospace;color:#e2e6ec}
.msrbox{background:var(--pane);border:1px solid var(--line);border-radius:6px;padding:8px;margin-bottom:8px}
.msrbox h4{margin:0 0 6px;font-size:13px;display:flex;gap:8px;align-items:center}.msrbox h4 .sp{flex:1}
.msrbox table{width:100%;border-collapse:collapse;font-size:13px}.msrbox td,.msrbox th{padding:3px 4px;border-bottom:1px solid var(--line2);text-align:left}
.msrbox td.n{font-family:Consolas,monospace;text-align:right}.msrbox .src{font-size:12px;color:var(--sub)}
.msrbox .mini,.vbar .mini2{font-size:12px;padding:1px 8px}
.vbar .mscale{white-space:nowrap;display:inline-flex;gap:8px;align-items:center;font-size:13px;color:#fff;background:#2c3a4f;border:1px solid #4a5d7a;border-radius:6px;padding:2px 4px 2px 8px}
.vbar .mscale b,.mbar2 .mscale b{color:#ffd23f;font-family:Consolas,monospace}.mbar2 .mscale button,.vbar .mscale button{background:#e8edf4;color:#14202e;border-color:#e8edf4;font-size:12px;padding:1px 8px}
.mhud{position:absolute;left:12px;top:12px;background:rgba(17,19,23,.9);color:#fff;border:1px solid #4a5d7a;border-radius:8px;padding:8px 12px;font:13px/1.5 system-ui,sans-serif;z-index:3;pointer-events:none}
.mhud b{font:700 18px/1.3 Consolas,monospace;color:#ffd23f}.mhud .d{font-family:Consolas,monospace;color:#e2e6ec}.mhud .s{color:#c9d2de;font-size:12px}`;
const LIST = (rows, data) => `<div class="msrbox"><h4>計測 <span class="sp"></span><button type="button" class="mini">すべて消す</button></h4><table><tr><th>#</th><th>測った</th><th>px</th><th></th></tr>${rows}</table>${data || ""}<div class="src">物差し 横 0.086・縦 0.179 mm/px（推定・24 件）</div></div>`;
const PANEL = (html) => `document.getElementById("vInfo").insertAdjacentHTML("afterbegin", ${JSON.stringify(html)});`;
const SCALE = `<span class="mscale" title="欠陥データの幅・長さと、画像の上の欠陥の大きさから割り出した値（このロットの 24 件の中央値）">物差し <b>横 0.086 / 縦 0.179 mm/px</b> 推定 24 件<button type="button">合わせる…</button></span>`;
const A = [0.66, 0.445], B = [0.80, 0.625];
const L1 = `<tr><td>1</td><td class="n">線 2.60 mm</td><td class="n">18.7</td><td>×</td></tr>`;
const R1 = `<tr><td>1</td><td class="n">枠 1.15 × 2.33 mm</td><td class="n">13 × 13</td><td>×</td></tr>`;
const CMP = `<table style="margin-top:6px"><tr><th></th><th>測った</th><th>欠陥データ</th></tr><tr><td>幅</td><td class="n">1.15 mm</td><td class="n">1.2 mm</td></tr><tr><td>長さ</td><td class="n">2.33 mm</td><td class="n">2.5 mm</td></tr></table>`;

export const PROPOSALS = [
  {
    key: "G", name: "モード無し（ドラッグ＝線・Shift＋ドラッグ＝枠）。読みは画像の左上の読み取り欄（欠陥に被らない）、画像の上は線と端の印だけ。物差しと操作の説明も読み取り欄に",
    css: BASE + `#vStage{cursor:crosshair}`,
    ops: [LIB, ["script", `window.__draw = () => { window.__line(${JSON.stringify(A)}, ${JSON.stringify(B)}, "", { parts: true });
      document.getElementById("vStage").insertAdjacentHTML("beforeend", '<div class="mhud"><b>2.60 mm</b> <span class="d">横 1.15 × 縦 2.33 mm ・ 18.7 px</span><div class="s">物差し 横 0.086 / 縦 0.179 mm/px（推定・24 件）</div><div class="s">ドラッグ＝線・Shift＋ドラッグ＝枠・右クリック＝消す</div></div>');
      ${PANEL(LIST(L1))} };`]],
  },
  {
    key: "H", name: "窓の上の帯の下に、細い計測の帯（操作の説明・いまの読み〈大きく〉・物差しと出どころ・合わせる…）。画像の上は線と端の印だけ。モード無し",
    css: BASE + `#vStage{cursor:crosshair}.mbar2{display:flex;gap:16px;align-items:center;padding:4px 12px;background:#18212e;color:#e2e6ec;font-size:13px;border-bottom:1px solid #2c3a4f}
.mbar2 b{font:700 16px Consolas,monospace;color:#ffd23f}.mbar2 .d{font-family:Consolas,monospace}.mbar2 .sp{flex:1}.mbar2 .s{color:#c9d2de;font-size:12px}`,
    ops: [LIB, ["insert", `<div class="mbar2"><span class="s">📏 ドラッグ＝線・Shift＝枠・右クリック＝消す</span><b>2.60 mm</b><span class="d">横 1.15 × 縦 2.33 mm ・ 18.7 px</span><span class="sp"></span>${SCALE.replace('class="mscale"', 'class="mscale" style="display:inline-flex;gap:8px;align-items:center;color:#fff;background:#2c3a4f;border:1px solid #4a5d7a;border-radius:6px;padding:2px 4px 2px 8px"')}</div>`, "afterend", "#viewer .vbar"],
      ["script", `window.__draw = () => { window.__line(${JSON.stringify(A)}, ${JSON.stringify(B)}, "", { parts: true }); ${PANEL(LIST(L1))} };`]],
  },
  {
    key: "I", name: "枠が主（ドラッグ＝枠で幅 × 長さ・Shift＝線）。札は枠の外の下（欠陥に被らない）。右の欄で欠陥データの幅・長さと並べて比べる。物差しは窓の上に読める色で",
    css: BASE + `#vStage{cursor:crosshair}`,
    ops: [LIB, ["insert", SCALE, "beforebegin", "#zoomSeg"],
      ["script", `window.__draw = () => { window.__line(${JSON.stringify(A)}, ${JSON.stringify(B)}, "幅 1.15 × 長さ 2.33 mm<small>13 × 13 px ・ Shift＋ドラッグで線</small>", { rect: true, at: [${A[0]}, ${B[1] + 0.03}] });
      ${PANEL(LIST(R1, CMP))} };`]],
  },
  {
    key: "J", name: "線＋引き出しの札（線の端から、欠陥の無い空いた所へ線で引き出す）。何本でも引け、番号で右の欄の一覧と結ぶ。物差しは窓の上",
    css: BASE + `#vStage{cursor:crosshair}`,
    ops: [LIB, ["insert", SCALE, "beforebegin", "#zoomSeg"],
      ["script", `window.__draw = () => { window.__line(${JSON.stringify(A)}, ${JSON.stringify(B)}, "① 2.60 mm<small>横 1.15 × 縦 2.33 mm ・ 18.7 px</small>", { lead: true, at: [0.50, 0.80] });
      ${PANEL(LIST(L1.replace("<td>1</td>", "<td>①</td>")))} };`]],
  },
  {
    key: "K", name: "F の直し（持ち越し）: モード無し・札は線の端の外の下・横と縦の補助線・窓の上に物差し（読める色）と操作の説明・右の欄に一覧",
    css: BASE + `#vStage{cursor:crosshair}.mhint{font-size:12px;color:#d6dde6;white-space:nowrap}`,
    ops: [LIB, ["insert", `${SCALE}<span class="mhint">ドラッグ＝計測・右クリック＝消す</span>`, "beforebegin", "#zoomSeg"],
      ["script", `window.__draw = () => { window.__line(${JSON.stringify(A)}, ${JSON.stringify(B)}, "2.60 mm<small>横 1.15 × 縦 2.33 mm ・ 18.7 px</small>", { parts: true });
      ${PANEL(LIST(L1))} };`]],
  },
];
