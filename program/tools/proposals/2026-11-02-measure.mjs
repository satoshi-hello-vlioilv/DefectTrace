// 拡大画像の計測（ドラッグで線を引いて長さを測る）の案（1 回目）。拡大の窓を開き、欠陥の上に線を引いた様子を撮る:
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-11-02-measure.mjs
//
// 今の困りごと（ui-check の info-1728・info-1280 を見て）:
//  1. 拡大の窓でできるのは拡大（全体・1x・2x・4x）と送りだけ。画像の上で長さを測る手段が無い
//  2. 右の欄に欠陥データの幅 1.2 mm・長さ 2.5 mm は出るが、画像（96×72 px）の 1 画素が何 mm かはどこにも無い（px と mm を結べない）
//  3. ラインセンサの画像は、横（幅方向: カメラの視野 ÷ 画素）と縦（長さ方向: 速さ ÷ 走査の回数）で 1 画素の大きさが違う。1 つの倍率では測れない
// 案の方向: 測る形（線・長方形・断面で端を自動）× 操作の入り方（モード・常に）× 物差しの出どころの見せ方（推定・校正・目盛り）
// 例の数: 物差し 横 0.086 mm/px・縦 0.179 mm/px（欠陥データの幅 1.2 mm・長さ 2.5 mm と、画像の欠陥 14×14 px から割った値）

// 線を描く（座標は画像の中の割合）。札 label・端の印・横縦の補助線（parts）
const LIB = ["script", `
window.__ov = () => { const st = document.getElementById("vStage"); st.style.position = "relative";
  let o = document.getElementById("mOv"); if (!o) { o = document.createElement("div"); o.id = "mOv"; st.append(o); }
  const im = document.getElementById("vImg").getBoundingClientRect(), sr = st.getBoundingClientRect();
  Object.assign(o.style, { position: "absolute", left: (im.left - sr.left) + "px", top: (im.top - sr.top) + "px", width: im.width + "px", height: im.height + "px", pointerEvents: "none" });
  return { o, w: im.width, h: im.height }; };
window.__line = (a, b, label, opt = {}) => { const { o, w, h } = window.__ov();
  const [x0, y0, x1, y1] = [a[0] * w, a[1] * h, b[0] * w, b[1] * h], c = opt.color || "#ffd23f";
  let s = '<svg width="' + w + '" height="' + h + '" style="position:absolute;inset:0;overflow:visible">';
  if (opt.parts) s += '<path d="M' + x0 + ' ' + y0 + 'H' + x1 + 'V' + y1 + '" fill="none" stroke="' + c + '" stroke-width="1.5" stroke-dasharray="5 4" opacity=".75"/>';
  if (opt.rect) s += '<rect x="' + Math.min(x0, x1) + '" y="' + Math.min(y0, y1) + '" width="' + Math.abs(x1 - x0) + '" height="' + Math.abs(y1 - y0) + '" fill="rgba(255,210,63,.08)" stroke="' + c + '" stroke-width="2.5"/>';
  else s += '<line x1="' + x0 + '" y1="' + y0 + '" x2="' + x1 + '" y2="' + y1 + '" stroke="#111" stroke-width="5" opacity=".55"/><line x1="' + x0 + '" y1="' + y0 + '" x2="' + x1 + '" y2="' + y1 + '" stroke="' + c + '" stroke-width="2.5"/>';
  for (const [x, y] of [[x0, y0], [x1, y1]]) s += '<circle cx="' + x + '" cy="' + y + '" r="6" fill="#111" stroke="' + c + '" stroke-width="2.5"/>';
  s += '</svg>';
  const lx = opt.at ? opt.at[0] * w : (x0 + x1) / 2 + 18, ly = opt.at ? opt.at[1] * h : (y0 + y1) / 2 - 18;
  s += '<div class="mlab" style="position:absolute;left:' + lx + 'px;top:' + ly + 'px;transform:translate(0,-100%)">' + label + '</div>';
  o.insertAdjacentHTML("beforeend", s); };
`];
const OPEN = `return (async () => {
  const th = document.querySelector("#grid .th"); th.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 700)); if (window.__draw) window.__draw();
})()`;
export const STATES = { measure: OPEN };

const BASE = `.mlab{background:rgba(17,19,23,.88);color:#fff;border:1px solid #ffd23f;border-radius:6px;padding:4px 9px;font:600 14px/1.35 Consolas,monospace;white-space:nowrap}
.mlab small{display:block;font:500 12px/1.35 Consolas,monospace;color:#d6dbe3}
.vbar .mtool{display:inline-flex;gap:6px;align-items:center}.vbar .mtool.on{background:#ffd23f;border-color:#ffd23f;color:#111}
.msrbox{background:var(--pane);border:1px solid var(--line);border-radius:6px;padding:8px;margin-bottom:8px}
.msrbox h4{margin:0 0 6px;font-size:13px;display:flex;gap:8px;align-items:center}.msrbox h4 .sp{flex:1}
.msrbox table{width:100%;border-collapse:collapse;font-size:13px}.msrbox td,.msrbox th{padding:3px 4px;border-bottom:1px solid var(--line2);text-align:left}
.msrbox td.n{font-family:Consolas,monospace;text-align:right}.msrbox .src{font-size:12px;color:var(--sub)}
.msrbox .mini{font-size:12px;padding:1px 8px}`;
const TOOL = (on, extra = "") => ["insert", `<button type="button" class="mtool${on ? " on" : ""}" title="ドラッグで線を引いて長さを測る（M）">📏 計測</button>${extra}`, "beforebegin", "#zoomSeg"];
const A = [0.66, 0.445], B = [0.80, 0.625];

export const PROPOSALS = [
  {
    key: "A", name: "計測モード（窓の上の「📏 計測」・M キー）＋線＋線の横に札「2.60 mm / 18.7 px」。結果は右の欄の先頭に表（消す・複数）",
    css: BASE,
    ops: [LIB, TOOL(true),
      ["script", `window.__draw = () => { document.getElementById("vInfo").insertAdjacentHTML("afterbegin", ${JSON.stringify(`<div class="msrbox"><h4>計測 <span class="sp"></span><button type="button" class="mini">すべて消す</button></h4><table><tr><th>#</th><th>長さ</th><th>px</th><th></th></tr><tr><td>1</td><td class="n">2.60 mm</td><td class="n">18.7</td><td>×</td></tr></table><div class="src">物差し 横 0.086・縦 0.179 mm/px（推定）</div></div>`)}); window.__line(${JSON.stringify(A)}, ${JSON.stringify(B)}, "2.60 mm<small>18.7 px</small>"); };`]],
  },
  {
    key: "B", name: "常に測れる（モード無し。画像の上のドラッグ＝線、Space＋ドラッグで送る）。札に長さと横・縦の内訳、横・縦の補助線",
    css: BASE + `#vStage{cursor:crosshair}`,
    ops: [LIB,
      ["insert", `<span class="mhint" style="font-size:12px;color:#c9d2de">ドラッグで計測・Space＋ドラッグで移動・右クリックで消す</span>`, "beforebegin", "#zoomSeg"],
      ["script", `window.__draw = () => window.__line(${JSON.stringify(A)}, ${JSON.stringify(B)}, "2.60 mm<small>横 1.15 mm × 縦 2.33 mm ・ 18.7 px</small>", { parts: true });`]],
  },
  {
    key: "C", name: "長方形で測る（ドラッグで枠＝幅 × 長さ。欠陥データの「幅・長さ」と同じ物差し）。Shift＋ドラッグで線。右の欄でデータと並べて比べる",
    css: BASE,
    ops: [LIB, TOOL(true, `<span class="seg" style="margin-left:4px"><button type="button" class="on">□ 枠</button><button type="button">／ 線</button></span>`),
      ["script", `window.__draw = () => { document.getElementById("vInfo").insertAdjacentHTML("afterbegin", ${JSON.stringify(`<div class="msrbox"><h4>計測（枠） <span class="sp"></span><button type="button" class="mini">消す</button></h4><table><tr><th></th><th>測った</th><th>欠陥データ</th></tr><tr><td>幅</td><td class="n">1.15 mm</td><td class="n">1.2 mm</td></tr><tr><td>長さ</td><td class="n">2.33 mm</td><td class="n">2.5 mm</td></tr><tr><td>面積</td><td class="n">2.68 mm²</td><td class="n">2.40 mm²</td></tr></table><div class="src">物差し 横 0.086・縦 0.179 mm/px（推定）</div></div>`)}); window.__line(${JSON.stringify(A)}, ${JSON.stringify(B)}, "幅 1.15 × 長さ 2.33 mm<small>13.4 × 13.0 px</small>", { rect: true }); };`]],
  },
  {
    key: "D", name: "線＋線に沿った明るさの断面（下の帯）。暗い所の端を自動で読み「欠陥の長さ 2.41 mm（自動）」と、手で引いた長さを並べる",
    css: BASE + `.vbody{position:relative}.mprof{position:absolute;left:12px;right:352px;bottom:12px;height:120px;background:rgba(17,19,23,.9);border:1px solid #3d4d66;border-radius:6px;color:#dfe5ec;font:12px Consolas,monospace;padding:6px 10px}`,
    ops: [LIB, TOOL(true),
      ["insert", `<div class="mprof"><div style="display:flex;gap:16px"><b style="color:#ffd23f">線 2.60 mm</b><b style="color:#7fd1ff">暗い所（自動） 2.41 mm</b><span>明るさ 40〜196</span></div><svg width="100%" height="84" viewBox="0 0 600 84" preserveAspectRatio="none"><rect x="0" y="0" width="600" height="84" fill="none"/><polyline fill="none" stroke="#dfe5ec" stroke-width="1.5" points="0,18 40,22 80,15 120,20 160,17 200,72 240,74 280,73 320,75 360,72 400,73 440,20 480,16 520,22 560,18 600,20"/><rect x="190" y="0" width="225" height="84" fill="rgba(127,209,255,.18)" stroke="#7fd1ff"/></svg></div>`, "beforeend", ".vbody"],
      ["script", `window.__draw = () => window.__line(${JSON.stringify(A)}, ${JSON.stringify(B)}, "2.60 mm<small>暗い所 2.41 mm（自動）</small>");`]],
  },
  {
    key: "E", name: "物差し（画像の上と左に mm の目盛り）＋十字の照準と座標の読み（x 37 px・y 28 px）＋ドラッグで線",
    css: BASE + `#vStage{cursor:crosshair}.rul{position:absolute;background:rgba(17,19,23,.82);color:#dfe5ec;font:11px Consolas,monospace;pointer-events:none}`,
    ops: [LIB, TOOL(true, `<span style="font:12px Consolas,monospace;color:#c9d2de">x 37 px (3.2 mm) ・ y 28 px (5.0 mm)</span>`),
      ["script", `window.__draw = () => { const { o, w, h } = window.__ov();
        let top = '<div class="rul" style="left:0;top:0;width:' + w + 'px;height:22px">', left = '<div class="rul" style="left:0;top:22px;width:34px;height:' + (h - 22) + 'px">';
        for (let mm = 0; mm <= 8; mm++) { const x = mm / (96 * 0.086) * w; top += '<span style="position:absolute;left:' + x + 'px;bottom:0;border-left:1px solid #dfe5ec;height:' + (mm % 2 ? 6 : 10) + 'px"></span>' + (mm % 2 ? '' : '<span style="position:absolute;left:' + (x + 3) + 'px;top:1px">' + mm + '</span>'); }
        for (let mm = 0; mm <= 12; mm += 2) { const y = mm / (72 * 0.179) * h; left += '<span style="position:absolute;top:' + y + 'px;right:0;border-top:1px solid #dfe5ec;width:10px"></span><span style="position:absolute;top:' + (y + 2) + 'px;left:2px">' + mm + '</span>'; }
        o.insertAdjacentHTML("beforeend", top + '<span style="position:absolute;right:4px;top:3px">mm</span></div>' + left + '</div>');
        o.insertAdjacentHTML("beforeend", '<div style="position:absolute;left:0;right:0;top:' + 0.39 * h + 'px;border-top:1px dashed rgba(255,255,255,.5)"></div><div style="position:absolute;top:0;bottom:0;left:' + 0.385 * w + 'px;border-left:1px dashed rgba(255,255,255,.5)"></div>');
        window.__line(${JSON.stringify(A)}, ${JSON.stringify(B)}, "2.60 mm<small>18.7 px</small>"); };`]],
  },
  {
    key: "F", name: "B＋物差しの出どころの帯（窓の上: 「物差し 推定 横 0.086・縦 0.179 mm/px（欠陥 24 件の幅・長さから）」・合わせる…）。推定が無ければ px だけ",
    css: BASE + `#vStage{cursor:crosshair}.mscale{white-space:nowrap;display:inline-flex;gap:8px;align-items:center;font-size:12px;color:#dfe5ec;background:#2c3a4f;border:1px solid #3d4d66;border-radius:6px;padding:2px 8px}.mscale b{color:#ffd23f;font-family:Consolas,monospace}`,
    ops: [LIB,
      ["insert", `<span class="mscale" title="物差し: 欠陥データの幅・長さと、画像の上の欠陥の大きさから割り出した値（このロットの 24 件の中央値）。ドラッグで計測・右クリックで消す">📏 <b>横 0.086 / 縦 0.179 mm/px</b> 推定<button type="button" class="mini">合わせる…</button></span>`, "beforebegin", "#zoomSeg"],
      ["script", `window.__draw = () => window.__line(${JSON.stringify(A)}, ${JSON.stringify(B)}, "2.60 mm<small>横 1.15 × 縦 2.33 mm ・ 18.7 px</small>", { parts: true });`]],
  },
];
