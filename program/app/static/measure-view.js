// 拡大画像の計測（ドラッグで線を引いて長さを測る）。形は 2 回の案出しと別のエージェントの採点で H に決めた
// （program/tools/proposals/2026-11-02-measure*）: 窓の上の帯の下に細い計測の帯（操作の説明・いまの読み・物差しと出どころ・合わせる…）。
// 画像の上は線（枠）と端の印・番号だけで、欠陥を覆わない。モード無し: ドラッグ＝線・Shift＋ドラッグ＝枠・右クリック＝最後の 1 つを消す。
// 右の欄の先頭に計測の一覧と、欠陥データの 幅・長さ との比べ。
//
// 物差し（mm/px）は横（幅方向）と縦（長さ方向）の 2 つ（ラインセンサの画像は 1 画素の大きさが縦と横で違う）。出どころは
//   合わせた値（この設備で、長さの分かる所を測って入れた値。作業場所の scales.json）→ 推定（欠陥データの幅・長さ ÷ 画像の上の欠陥の大きさ。
//   ロットの画像の中央値）の順。どちらも無ければ px だけを出し、mm を作らない。
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const q = (o) => new URLSearchParams(o).toString();
  const MAX = 9;   // 1 枚に引ける数（番号 ①〜⑨）
  const NUM = "①②③④⑤⑥⑦⑧⑨";
  const M = { list: [], drag: null, key: "", scale: null, scaleKey: "", loading: "" };

  const ctx = () => window.dtViewer.ctx();
  const f2 = (v) => (Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2));
  const fmtScale = (v) => (v >= 0.1 ? v.toFixed(3) : v.toPrecision(3));

  // ---------------------------------------------------------------- 物差し
  async function loadScale(force) {
    const c = ctx(); if (!c) return;
    const k = `${c.lot}|${c.it.g}|${c.eq}`;
    if (!force && (M.scaleKey === k || M.loading === k)) return;
    M.loading = k;
    try {
      const r = await fetch("/api/scale?" + q({ lot: c.lot, g: c.it.g, eq: c.eq || "" }));
      M.scale = r.ok ? await r.json() : null;
    } catch (_) { M.scale = null; }
    if (M.loading !== k) return;
    M.scaleKey = k; M.loading = "";
    render();
  }
  const sc = () => (M.scale && M.scale.x > 0 && M.scale.y > 0 ? M.scale : null);

  // ---------------------------------------------------------------- 画像の上の位置（原寸の画素）
  /** 絵の範囲（全体表示では要素の箱の中で縦横比を保って収まる。その範囲） */
  function picture() {
    const im = $("vImg"), nw = im.naturalWidth, nh = im.naturalHeight;
    if (!nw || !nh) return null;
    const bw = im.clientWidth, bh = im.clientHeight, s = Math.min(bw / nw, bh / nh);
    return { nw, nh, s, x: im.offsetLeft + (bw - nw * s) / 2, y: im.offsetTop + (bh - nh * s) / 2 };
  }
  function toImage(e) {
    const p = picture(); if (!p) return null;
    const st = $("vStage"), r = st.getBoundingClientRect();
    const x = (e.clientX - r.left + st.scrollLeft - p.x) / p.s, y = (e.clientY - r.top + st.scrollTop - p.y) / p.s;
    return [Math.max(0, Math.min(p.nw, x)), Math.max(0, Math.min(p.nh, y))];
  }

  // ---------------------------------------------------------------- 読み
  /** 1 つの計測の値（px と、物差しがあれば mm） */
  function value(m) {
    const dx = Math.abs(m.b[0] - m.a[0]), dy = Math.abs(m.b[1] - m.a[1]), s = sc();
    const px = Math.hypot(dx, dy);
    if (m.rect) {
      return s
        ? { main: `幅 ${f2(dx * s.x)} × 長さ ${f2(dy * s.y)} mm`, parts: `面積 ${f2(dx * s.x * dy * s.y)} mm² ・ ${dx.toFixed(1)} × ${dy.toFixed(1)} px`, w: dx * s.x, l: dy * s.y, short: `${f2(dx * s.x)} × ${f2(dy * s.y)} mm`, px: `${dx.toFixed(0)} × ${dy.toFixed(0)}` }
        : { main: `幅 ${dx.toFixed(1)} × 長さ ${dy.toFixed(1)} px`, parts: "物差しが無いので px だけ", short: `${dx.toFixed(0)} × ${dy.toFixed(0)} px`, px: `${dx.toFixed(0)} × ${dy.toFixed(0)}` };
    }
    // 線の内訳は 3 px 以上ある向きだけ（横に引いた線に「長さ 0.00」を出さない。右の欄の比べと同じ基準）
    const axes = (fw, fl, unit) => [dx >= 3 && `幅 ${fw}`, dy >= 3 && `長さ ${fl}`].filter(Boolean).join(" × ") + (dx >= 3 || dy >= 3 ? ` ${unit} ・ ` : "");
    return s
      ? { main: `${f2(Math.hypot(dx * s.x, dy * s.y))} mm`, parts: `${axes(f2(dx * s.x), f2(dy * s.y), "mm")}${px.toFixed(1)} px`, w: dx * s.x, l: dy * s.y, short: `${f2(Math.hypot(dx * s.x, dy * s.y))} mm`, px: px.toFixed(1) }
      : { main: `${px.toFixed(1)} px`, parts: `${axes(dx.toFixed(1), dy.toFixed(1), "px")}物差しが無いので px だけ`, short: `${px.toFixed(1)} px`, px: px.toFixed(1) };
  }

  // ---------------------------------------------------------------- 描く
  function draw() {
    const svg = $("mSvg"), p = picture();
    if (!p || $("viewer").hidden) { svg.innerHTML = ""; return; }
    const st = $("vStage");
    Object.assign(svg.style, { width: st.scrollWidth + "px", height: st.scrollHeight + "px" });
    const X = (v) => p.x + v * p.s, Y = (v) => p.y + v * p.s;
    const all = M.drag ? [...M.list, M.drag] : M.list;
    svg.innerHTML = all.map((m, i) => {
      const [x0, y0, x1, y1] = [X(m.a[0]), Y(m.a[1]), X(m.b[0]), Y(m.b[1])];
      const shape = m.rect
        ? `<rect x="${Math.min(x0, x1)}" y="${Math.min(y0, y1)}" width="${Math.abs(x1 - x0)}" height="${Math.abs(y1 - y0)}" class="mk-under"/><rect x="${Math.min(x0, x1)}" y="${Math.min(y0, y1)}" width="${Math.abs(x1 - x0)}" height="${Math.abs(y1 - y0)}" class="mk-line"/>`
        : `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" class="mk-under"/><line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" class="mk-line"/>`;
      const ends = [[x0, y0], [x1, y1]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" class="mk-end"/>`).join("");
      // 番号（右の欄の一覧と結ぶ）は、終わりの端の外側（欠陥の上に置かない）
      const nx = x1 + (x1 >= x0 ? 18 : -18), ny = y1 + (y1 >= y0 ? 18 : -18);
      const num = i < M.list.length ? `<text x="${nx}" y="${ny}" class="mk-num" text-anchor="middle" dominant-baseline="central">${NUM[i]}</text>` : "";
      return shape + ends + num;
    }).join("");
  }
  function render() {
    const s = sc(), last = M.drag || M.list[M.list.length - 1];
    const v = last && value(last);
    $("mVal").textContent = v ? v.main : "";
    $("mParts").textContent = v ? v.parts : "画像の上でドラッグすると、ここに長さが出ます";
    const src = !M.scale ? "物差しなし（px だけ）" : M.scale.from === "calib" ? `合わせた値（${M.scale.at || ""}）` : `推定・${M.scale.n} 件`;
    $("mScale").innerHTML = `<span class="ms-l">物差し</span>${s ? `<span class="ms-v">幅 ${fmtScale(s.x)} / 長さ ${fmtScale(s.y)} mm/px</span>` : ""}<span class="ms-s" title="${esc(scaleHelp())}">${esc(src)}</span><button type="button" id="mCalBtn" title="長さの分かる所を測って、物差しを合わせる">合わせる…</button>`;
    draw();
    panel();
  }
  const scaleHelp = () => (M.scale?.from === "estimate"
    ? `欠陥データの幅・長さと、画像の上の欠陥の大きさから割り出した値（このロットの ${M.scale.n} 件の中央値。ばらつき 幅 ±${Math.round((M.scale.spread_x || 0) * 50)}%・長さ ±${Math.round((M.scale.spread_y || 0) * 50)}%）。確かな値は「合わせる…」で`
    : M.scale?.from === "calib" ? "この設備で、長さの分かる所を測って入れた値" : "欠陥データに幅・長さが無いか、画像の上に欠陥が見つからないため、物差しを決められません。「合わせる…」で入れられます");

  /** 右の欄の先頭: 計測の一覧と、欠陥データの幅・長さとの比べ */
  function panel() {
    const box = $("vInfo"); if (!box) return;
    box.querySelector(":scope>.msrbox")?.remove();
    if (!M.list.length) return;
    const c = ctx(), det = c?.img?.detect || [];
    const dval = (name) => { const f = det.find((x) => x[0] === name); return f ? f[1] : ""; };
    const rows = M.list.map((m, i) => { const v = value(m); return `<tr><td>${NUM[i]}</td><td class="n">${m.rect ? "枠" : "線"} ${esc(v.short)}</td><td class="n">${esc(v.px)}</td><td><button type="button" class="mini" data-mdel="${i}" title="消す">×</button></td></tr>`; }).join("");
    // 欠陥データの幅・長さと比べる: 枠があれば最後の枠、無ければ最後の線（線は 3 px 以上ある向きだけ。横に引いた線の「長さ 0.00」を出さない）
    const ri = M.list.map((m) => m.rect).lastIndexOf(true), ci = ri >= 0 ? ri : M.list.length - 1, cm = M.list[ci], cv = value(cm);
    const span = (k) => cm.rect || Math.abs(cm.b[k] - cm.a[k]) >= 3;
    const crow = (name, on, mm, data) => (on && data ? `<tr><td>${name}</td><td class="n">${f2(mm)} mm</td><td class="n">${esc(data)} mm</td></tr>` : "");
    const crows = sc() ? crow("幅", span(0), cv.w, dval("width_mm")) + crow("長さ", span(1), cv.l, dval("length_mm")) : "";
    const cmp = crows ? `<table class="mcmp"><tr><th></th><th class="n">${NUM[ci]} 測った</th><th class="n">欠陥データ</th></tr>${crows}</table>` : "";
    box.insertAdjacentHTML("afterbegin", `<div class="msrbox"><div class="mh"><b>計測</b><span class="spacer"></span><button type="button" class="mini" data-mclear>すべて消す</button></div>
      <table><tr><th>#</th><th class="n">測った</th><th class="n">px</th><th></th></tr>${rows}</table>${cmp}</div>`);
  }

  // ---------------------------------------------------------------- 合わせる（校正）
  function openCal() {
    const last = M.list[M.list.length - 1], f = $("mCal");
    if (!last) { f.innerHTML = `<span>長さの分かる所（物差しの目盛り・寸法の分かる穴など）を、先に画像の上で測ってください</span><button type="button" data-calx>閉じる</button>`; f.hidden = false; return; }
    const dx = Math.abs(last.b[0] - last.a[0]), dy = Math.abs(last.b[1] - last.a[1]), s = sc();
    f.innerHTML = `<span>${NUM[M.list.length - 1]} の実際の長さ</span>
      <label>幅 <input type="number" step="any" min="0" id="mCalW" ${dx < 3 ? "disabled" : ""} placeholder="${dx < 3 ? "幅が短すぎます" : s ? f2(dx * s.x) : "mm"}"> mm <small>(${dx.toFixed(1)} px)</small></label>
      <label>長さ <input type="number" step="any" min="0" id="mCalL" ${dy < 3 ? "disabled" : ""} placeholder="${dy < 3 ? "長さが短すぎます" : s ? f2(dy * s.y) : "mm"}"> mm <small>(${dy.toFixed(1)} px)</small></label>
      <button type="submit" class="primary">この設備の物差しにする</button>${M.scale?.from === "calib" ? '<button type="button" data-calreset>推定に戻す</button>' : ""}<button type="button" data-calx>閉じる</button>
      <span class="mcal-n">片方だけ入れたときは、もう片方は今の物差しのまま（無ければ同じ値）</span>`;
    f.hidden = false;
    f.querySelector("input:not([disabled])")?.focus();
  }
  $("mCal").addEventListener("submit", async (e) => {
    e.preventDefault();
    const last = M.list[M.list.length - 1], c = ctx(); if (!last || !c) return;
    const dx = Math.abs(last.b[0] - last.a[0]), dy = Math.abs(last.b[1] - last.a[1]), s = sc();
    const w = parseFloat($("mCalW").value), l = parseFloat($("mCalL").value);
    let x = w > 0 && dx >= 3 ? w / dx : null, y = l > 0 && dy >= 3 ? l / dy : null;
    if (x == null && y == null) return;
    x ??= s ? s.x : y; y ??= s ? s.y : x;
    await fetch("/api/scale", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eq: c.eq, x, y }) });
    $("mCal").hidden = true; await loadScale(true);
  });
  $("mCal").addEventListener("click", async (e) => {
    if (e.target.closest("[data-calx]")) $("mCal").hidden = true;
    if (e.target.closest("[data-calreset]")) { const c = ctx(); await fetch("/api/scale", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eq: c.eq, x: null }) }); $("mCal").hidden = true; await loadScale(true); }
  });
  $("mBar").addEventListener("click", (e) => { if (e.target.closest("#mCalBtn")) { if ($("mCal").hidden) openCal(); else $("mCal").hidden = true; } });

  // ---------------------------------------------------------------- 操作（モード無し）
  const stage = $("vStage");
  stage.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || e.offsetX > stage.clientWidth || e.offsetY > stage.clientHeight) return;   // スクロールバーは送るため
    const p = toImage(e); if (!p) return;
    e.preventDefault();
    M.drag = { a: p, b: p, rect: e.shiftKey, x: e.clientX, y: e.clientY };
  });
  document.addEventListener("mousemove", (e) => {
    if (!M.drag) return;
    const p = toImage(e); if (!p) return;
    M.drag.b = p; M.drag.rect = e.shiftKey || M.drag.rect;
    render();
  });
  document.addEventListener("mouseup", (e) => {
    if (!M.drag) return;
    const d = M.drag; M.drag = null;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) >= 4) {   // 4px 未満は押しただけ（ダブルクリックの拡大などに任せる）
      M.list.push({ a: d.a, b: d.b, rect: d.rect });
      if (M.list.length > MAX) M.list.shift();
    }
    render();
  });
  stage.addEventListener("contextmenu", (e) => { e.preventDefault(); if (M.list.length) { M.list.pop(); render(); } });
  $("vInfo").addEventListener("click", (e) => {
    const del = e.target.closest("[data-mdel]");
    if (del) { M.list.splice(+del.dataset.mdel, 1); render(); }
    if (e.target.closest("[data-mclear]")) { M.list = []; render(); }
  });

  // ---------------------------------------------------------------- 窓の知らせ
  window.addEventListener("dt:viewer", (e) => {
    if (e.detail?.key !== M.key) { M.key = e.detail?.key || ""; M.list = []; $("mCal").hidden = true; }   // 画像を送ったら、計測は消す
    loadScale(); render();
  });
  window.addEventListener("dt:zoom", () => requestAnimationFrame(draw));
  window.addEventListener("dt:vinfo", panel);
  window.addEventListener("dt:vclose", () => { M.list = []; M.drag = null; M.key = ""; $("mCal").hidden = true; draw(); });
  // 画像の大きさ・位置が変わったら描き直す（合わせる欄の開け閉めで画像が下がって縮む・窓の大きさ・拡大。作った後の採点 2026-11-02: 線と枠がずれた）
  new ResizeObserver(() => { if (!$("viewer").hidden) requestAnimationFrame(draw); }).observe($("vStage"));
  new ResizeObserver(() => { if (!$("viewer").hidden) requestAnimationFrame(draw); }).observe($("vImg"));
  render();
})();
