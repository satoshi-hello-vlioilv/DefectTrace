// リスト表示（版 4.2.0）: 木の節（設備・年・月・日）の下のロットを表で出し、ロット単位で取れる値を列にして、全件を書き出す。
//
// - 列は裏の目録（/api/lotcols: フォルダ名・確かめ・1〜3 件の .dat の項目・条件の XML・分類別の欠陥数）。列の名前は項目の名前
//   （同じ名前が 2 つあれば置き場を添える）。式では [品名] のように書ける
// - 列の出し入れ・並び・表示名・幅・揃え・値の整え方・計算で作る列・読み替え・保存した設定・書き出しは、LotScope の表示列
//   （program/app/static/lotscope/lotlist-columns.js ほか。中身は変えずに持ち込んだ）がそのまま受け持つ。この部品は表を描き、
//   表示列に「いまの表」（ctx）を渡すだけ
// - 値は出している列（と式が使う列）だけを、40 ロットずつ読む（/api/lotrows）。読み込みの進みは画像の読み込みと同じ帯の形で出す
// - 書き出し（CSV・Excel）は、いまの絞り込み・並びの全件を、表示列の見え方（表示名・値の整え方・読み替え・計算列）のまま出す
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const natcmp = new Intl.Collator(undefined, { numeric: true }).compare;
  const LC = () => window.LotListColumns;
  const TARGET = "defecttrace:lots";            // 表示列の設定の名前（表は 1 つ）
  const KNOWN = "dt.lotlist.known.v1";          // 見たことのある列（新しく出た列は隠して足す。数百の XML の項目を一度に並べない）
  const BATCH = 40;
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 覚えられなくても動く */ } };

  const V = {
    host: null, scope: null, lots: [], cols: [], byName: new Map(), lotCol: "", cache: new Map(),
    sort: { col: "", dir: 1 }, q: "", gen: 0, need: 0, got: 0, busy: 0, bound: false,
    onOpen: null, defaults: [],
  };

  // ---------------------------------------------------------------- 器
  // onOpen(path): 行のロットを開く。onPick(path): 範囲のパンくずで節を選んだ（木の側が範囲を決め直して setScope を呼ぶ）
  // onCount(n): 範囲のロットの数（入口のタブの札。集め終えるまでは null）
  function mount(host, { onOpen, onPick, onCount } = {}) {
    V.host = host; V.onOpen = onOpen || null; V.onPick = onPick || null; V.onCount = onCount || null;
    host.innerHTML = `
      <div class="lv-bar">
        <nav class="lv-scope" id="lvScope" aria-label="一覧にするロットの範囲"></nav>
        <span class="lv-count" id="lvCount"></span>
        <span class="spacer"></span>
        <input id="lvSearch" type="search" placeholder="一覧を検索（どの列の字でも）" autocomplete="off">
        <button type="button" id="lvCols" title="出す列・並び・表示名・幅・値の整え方・計算で作る列・読み替え（LotScope と同じ表示列の設定）">表示列…</button>
        <button type="button" id="lvCsv" title="いまの検索・並びの全件を、表示列の見え方のまま CSV で保存">CSV</button>
        <button type="button" id="lvXlsx" class="primary" title="いまの検索・並びの全件を、表示列の見え方のまま Excel（.xlsx）で保存">Excel に出力</button>
      </div>
      <div class="lv-load lpband3" id="lvLoad" data-progress hidden></div>
      <div class="lv-wrap" id="lvWrap"><table class="ll-grid lv-grid" id="lvGrid"><colgroup id="lvColgroup"></colgroup><thead id="lvHead"></thead><tbody id="lvBody"></tbody></table>
        <div class="empty" id="lvEmpty">左の木で設備・年・月・日を選ぶと、その下のロットをここに一覧にします</div></div>
      <style id="lvTint"></style>`;
    $("lvSearch").addEventListener("input", () => { V.q = $("lvSearch").value.trim().toLowerCase(); render(); });
    $("lvCols").addEventListener("click", () => { if (!V.cols.length) return; setContext(); LC().toggle(); });
    $("lvCsv").addEventListener("click", () => exportAs("csv"));
    $("lvXlsx").addEventListener("click", () => exportAs("xlsx"));
    $("lvWrap").addEventListener("scroll", () => { if (!V.raf) V.raf = requestAnimationFrame(() => { V.raf = 0; paintBody(); }); }, { passive: true });
    $("lvScope").addEventListener("click", (e) => { const b = e.target.closest("[data-path]"); if (!b) return; if (V.onPick) V.onPick(b.dataset.path); else setScope({ path: b.dataset.path, eq: V.scope.eq, crumbs: V.scope.crumbs.slice(0, +b.dataset.i + 1) }); });
    $("lvHead").addEventListener("click", (e) => {
      const th = e.target.closest("th[data-col]"); if (!th || e.target.closest(".col-resize")) return;
      const c = th.dataset.col;
      V.sort = V.sort.col !== c ? { col: c, dir: 1 } : V.sort.dir === 1 ? { col: c, dir: -1 } : { col: "", dir: 1 };
      render();
    });
    $("lvBody").addEventListener("dblclick", (e) => { const tr = e.target.closest("tr[data-path]"); if (tr && V.onOpen) V.onOpen(tr.dataset.path); });
    render();
  }

  // ---------------------------------------------------------------- 範囲（木の節）
  // scope: { path, eq, crumbs: [{label, path}] }（crumbs は設備から選んだ節まで。押すと範囲を広げられる）
  async function setScope(scope) {
    if (!V.host || !scope || (V.scope && V.scope.path === scope.path && V.lots.length)) { if (scope) V.scope = scope; paintScope(); return; }
    V.scope = scope;
    const gen = ++V.gen;
    V.lots = []; V.sort = { col: "", dir: 1 };
    paintScope(); progress({ phase: "ロットを集めています", n: 0, total: 0 }); V.onCount?.(null);
    let d;
    try { d = await (await fetch("/api/lots?" + new URLSearchParams({ path: scope.path }))).json(); } catch (e) { d = { error: e.message }; }
    if (gen !== V.gen) return;
    if (d.error) { progress(null); $("lvEmpty").textContent = d.error; $("lvEmpty").hidden = false; return; }
    V.lots = d.lots || [];
    V.onCount?.(V.lots.length);
    await loadColumns(gen);
    if (gen !== V.gen) return;
    render();
    await fill(gen);
  }
  function paintScope() {
    const s = V.scope;
    $("lvScope").innerHTML = s ? `<span class="lv-sl">範囲</span>` + s.crumbs.map((c, i) => (i === s.crumbs.length - 1
      ? `<b>${esc(c.label)}</b>` : `<button type="button" class="lnk" data-path="${esc(c.path)}" data-i="${i}" title="範囲を「${esc(c.label)}」全体に広げる">${esc(c.label)}</button><span class="lv-sep">›</span>`)).join("")
      : '<span class="sub">範囲を選んでください</span>';
  }

  // ---------------------------------------------------------------- 列
  async function loadColumns(gen) {
    // 見本: 新しい・真ん中・古いロット（ロットごとに条件の XML の項目が違っても、だいたい拾える）
    const n = V.lots.length, pick = [...new Set([0, 1, Math.floor(n / 2), n - 2, n - 1].filter((i) => i >= 0 && i < n))].map((i) => V.lots[i].path);
    let cat = [];
    try { cat = await (await fetch("/api/lotcols", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paths: pick }) })).json(); } catch (e) { cat = []; }
    if (gen !== V.gen) return;
    let pins = [];
    try { pins = await (await fetch("/api/pins")).json(); } catch (e) { pins = []; }
    if (gen !== V.gen) return;
    V.pins = pins;
    // 列と同じ項目（ファイル・鍵）の表示項目があれば、その単位の倍率（scale）・日時の形（fmt）で値を作る
    // （サマリの「検査長(m)」は mm の値 × 0.001。表と画面で同じ項目は同じ値にする）。表示先は 一覧 → サマリ → ロット情報 の順に採る
    const rank = { list: 0, summary: 1, lot: 2 };
    V.unit = new Map();
    pins.filter((p) => p.scope === "lot").sort((a, b) => (rank[a.place] ?? 9) - (rank[b.place] ?? 9))
      .forEach((p) => { const id = `${p.file}|${p.key}`; if (!V.unit.has(id)) V.unit.set(id, p); });
    const count = new Map();
    cat.forEach((c) => count.set(c.label, (count.get(c.label) || 0) + 1));
    V.byName = new Map();
    V.cols = cat.map((c) => { const name = count.get(c.label) > 1 ? `${c.label}（${c.group}）` : c.label; V.byName.set(name, c); return name; });
    V.lotCol = V.cols.find((c) => V.byName.get(c).id === "@lot|lot") || V.cols[0] || "";
    await seedLayout();
    // 見本のロットは、すべての列の値を読んでおく（表示列の窓の「見え方（実データ 1 件）」に、隠している列の値も出す）
    try {
      const d = await (await fetch("/api/lotrows", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: pick, cols: V.cols.map(spec) }) })).json();
      if (gen !== V.gen) return;
      pick.forEach((p) => { const v = d[p]; if (!Array.isArray(v)) return; const c = V.cache.get(p) || {}; V.cols.forEach((k, j) => { c[k] = v[j]; }); V.cache.set(p, c); });
    } catch (e) { /* 見本が無くても一覧は出せる */ }
  }
  // 1 つの列の問い合わせ（{file, key} と、同じ項目の表示項目の scale・fmt）
  function spec(k) {
    const c = V.byName.get(k), p = V.unit && V.unit.get(c.id), out = { file: c.file, key: c.key };
    if (p && p.scale != null) out.scale = p.scale;
    if (p && p.fmt) out.fmt = p.fmt;
    return out;
  }
  // 初めての表: ロット・作業日時・木の一覧に出している項目・確かめを出し、ほかは隠す。前から使っている表: 新しく出た列だけ隠して足す
  async function seedLayout() {
    const pins = V.pins || [];
    const byId = new Map(V.cols.map((c) => [V.byName.get(c).id, c]));
    const want = ["@lot|lot", "@lot|date", "@lot|time", ...pins.filter((p) => p.place === "list" || p.place === "summary").map((p) => `${p.file}|${p.key}`),
      "@check|overload", "@check|detect_max", "@check|time_warn"].map((id) => byId.get(id)).filter(Boolean);
    // 「欠陥数（分類の合計）」（@check|defects）と分類別の列は、ロットごとに DETECT_INFO（数 MB）を読むので、初めは出さない
    // （欠陥数は INSP_INFO の欠陥総数を出している。突き合わせたいときに表示列から出す）
    V.defaults = [...new Set(want)];
    const known = new Set(lsGet(KNOWN, []));
    const l = LC().layoutOf(TARGET);
    const fresh = !known.size && !l.order.length;
    const added = V.cols.filter((c) => !known.has(c));
    // 表示名: 表示項目に付けた名前（サマリ・一覧の札と同じ言葉）を、まだ表示名を付けていない列に当てる。列の鍵（項目の名前）は変えない
    // （表示項目の名前を直しても、保存した並び・幅が外れない）
    const pinName = new Map(pins.filter((p) => p.scope === "lot" && p.label).map((p) => [`${p.file}|${p.key}`, p.label]));
    V.cols.forEach((c) => { const n = pinName.get(V.byName.get(c).id); if (n && n !== c && !l.names[c]) l.names[c] = n; });
    if (fresh) Object.assign(l, { order: V.defaults.concat(V.cols.filter((c) => !V.defaults.includes(c))), hidden: V.cols.filter((c) => !V.defaults.includes(c)) });
    else if (added.length) l.hidden = [...new Set(l.hidden.concat(added))];
    LC().replaceLayout(TARGET, l);
    lsSet(KNOWN, [...new Set([...known, ...V.cols])]);
  }
  const shownCols = () => LC().visible(TARGET, LC().allColumns(TARGET, V.cols), V.lotCol);
  // 読む列: 出している元の列と、出している計算列の式が使う列
  function neededCols() {
    const t = TARGET, out = new Set();
    for (const c of shownCols()) {
      if (V.byName.has(c)) { out.add(c); continue; }
      (LC().sourcesOf(t, c) || V.cols).forEach((s) => { if (V.byName.has(s)) out.add(s); });
    }
    return [...out];
  }
  function setContext() {
    LC().setContext({ target: TARGET, table: "lots", title: `ロット表：${V.scope ? V.scope.crumbs.map((c) => c.label).join(" › ") : ""}`, fileStem: "ロット表",
      place: "ロット表", columns: LC().allColumns(TARGET, V.cols), sourceColumns: V.cols, rows: rowsAll(), lotColumn: V.lotCol, grid: $("lvGrid"),
      rerender: () => { render(); fill(V.gen); }, toast: (m) => (window.dtStatus ? window.dtStatus(m) : null) });
  }

  // ---------------------------------------------------------------- 値（足りない列だけ・40 ロットずつ）
  async function fill(gen) {
    // 読む役は範囲ごと（gen）に 1 つ。前の範囲の読みは gen が変わった所で止まるので、待たずに今の範囲の読みを始める
    if (V.busy === gen || !V.lots.length) return;
    const cols = neededCols();
    const todo = V.lots.filter((l) => { const c = V.cache.get(l.path); return !c || cols.some((k) => !(k in c)); });
    if (!todo.length) { progress(null); return; }
    V.busy = gen; V.need = todo.length; V.got = 0;
    const t0 = performance.now();
    try {
      for (let i = 0; i < todo.length; i += BATCH) {
        if (gen !== V.gen) return;
        const part = todo.slice(i, i + BATCH);
        const miss = cols.filter((k) => part.some((l) => !(k in (V.cache.get(l.path) || {}))));
        const body = { paths: part.map((l) => l.path), cols: miss.map(spec) };
        let d = {};
        try { d = await (await fetch("/api/lotrows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json(); } catch (e) { d = {}; }
        if (gen !== V.gen) return;
        for (const l of part) {
          const c = V.cache.get(l.path) || {}, v = d[l.path];
          miss.forEach((k, j) => { c[k] = Array.isArray(v) ? v[j] : ""; });
          if (v && v.error) c.__error = v.error;
          V.cache.set(l.path, c);
        }
        V.got += part.length;
        const el = (performance.now() - t0) / 1000, rate = V.got / Math.max(el, 0.001);
        progress({ phase: "ロットの値を読んでいます", n: V.got, total: V.need, eta: rate > 0 ? (V.need - V.got) / rate : null });
        // 読む間は行だけを描き直す（0.5 秒に 1 度まで。列の幅・見出しは変わらないので作り直さない）。読み終えたら全部を描く
        if (V.got >= V.need) render();
        else if (performance.now() - (V.drawnAt || 0) > 500) { refreshRows(); V.drawnAt = performance.now(); }
      }
    } finally { if (V.busy === gen) V.busy = 0; }
    if (gen !== V.gen) return;
    progress(null);
    if (neededCols().some((k) => V.lots.some((l) => !(k in (V.cache.get(l.path) || {}))))) fill(gen);   // 読む間に列が増えた
  }
  const fmtN = (n) => Number(n || 0).toLocaleString("ja-JP");
  const fmtSec = (s) => (s == null ? "計算中" : s < 1 ? "1 秒未満" : s < 60 ? `約 ${Math.ceil(s)} 秒` : `約 ${Math.floor(s / 60)} 分 ${Math.round(s % 60)} 秒`);
  // 読み込みの進み（画像の読み込みと同じ帯の形: いまの段階・数・棒・残り時間）
  function progress(p) {
    const b = $("lvLoad"); if (!b) return;
    b.hidden = !p;
    if (!p) return;
    const frac = p.total ? p.n / p.total : null;
    b.innerHTML = `<div class="r1"><span class="now">${esc(p.phase)}</span>${p.total ? `<span class="num">${fmtN(p.n)} / ${fmtN(p.total)} ロット</span>` : ""}
      <div class="lpbar${frac == null ? " ind" : ""}"><i style="width:${frac == null ? 30 : Math.round(frac * 100)}%"></i></div>
      <span class="sub">あと</span><span class="lpeta">${esc(fmtSec(p.eta))}</span>${p.total ? '<span class="use">✓ 読めた行から見られます</span>' : ""}</div>`;
  }

  // ---------------------------------------------------------------- 行・並べ替え・検索
  function rowOf(l) {
    const c = V.cache.get(l.path) || {}, r = { __path: l.path };
    V.cols.forEach((k) => { if (k in c) r[k] = c[k]; });
    if (V.lotCol) r[V.lotCol] = l.name;
    return r;
  }
  const rowsAll = () => V.lots.map(rowOf);
  function viewRows(cols) {
    const t = TARGET;
    let rows = rowsAll();
    if (V.q) rows = rows.filter((r) => cols.some((c) => String(LC().cell(t, c, r).text).toLowerCase().includes(V.q)));
    if (V.sort.col && cols.includes(V.sort.col)) {
      const c = V.sort.col, key = (r) => { const x = LC().cell(t, c, r); const n = Number(String(x.raw).replace(/,/g, "")); return { n: String(x.raw).trim() !== "" && Number.isFinite(n) ? n : null, s: x.text }; };
      const ks = new Map(rows.map((r) => [r, key(r)]));
      rows.sort((a, b) => { const x = ks.get(a), y = ks.get(b);
        if (x.s === "" && y.s !== "") return 1; if (y.s === "" && x.s !== "") return -1;
        return V.sort.dir * (x.n != null && y.n != null ? x.n - y.n : natcmp(x.s, y.s)); });
    }
    return rows;
  }

  // ---------------------------------------------------------------- 描く
  function render() {
    if (!V.host) return;
    const empty = $("lvEmpty");
    if (!V.scope || !V.cols.length) {
      $("lvHead").innerHTML = ""; $("lvBody").innerHTML = ""; $("lvColgroup").innerHTML = ""; V.shown = null;
      $("lvCount").textContent = V.scope && !V.lots.length && !V.busy ? "ロットがありません" : "";
      empty.hidden = false;
      ["lvCols", "lvCsv", "lvXlsx"].forEach((id) => { $(id).disabled = true; });
      return;
    }
    empty.hidden = true;
    ["lvCols", "lvCsv", "lvXlsx"].forEach((id) => { $(id).disabled = false; });
    const t = TARGET;
    setContext();
    const cols = shownCols(), L = LC().get(t);
    const rows = viewRows(cols);
    const widths = cols.map((c) => LC().widthOf(t, c, rows));
    $("lvColgroup").innerHTML = cols.map((c, i) => `<col data-col="${esc(c)}" style="width:${widths[i]}px">`).join("");
    const grid = $("lvGrid");
    grid.style.width = widths.reduce((a, b) => a + b, 0) + "px";
    grid.style.setProperty("--ll-row-pad", LC().rowPad() + "px");
    grid.style.setProperty("--ll-cell-padx", LC().cellPad() + "px");
    grid.dataset.overflow = LC().overflow();
    $("lvHead").innerHTML = "<tr>" + cols.map((c) => {
      const calc = LC().isComputed(t, c), al = LC().alignOf(t, c), src = V.byName.get(c);
      const sorted = V.sort.col === c ? (V.sort.dir === 1 ? "asc" : "desc") : "";
      const tip = `${LC().label(t, c)}${calc ? "（計算列・式）" : src ? `\n元: ${src.group}・${src.key}` : ""}`
        + `\nクリックで ▲ 小さい順 → ▼ 大きい順 → 外す\nドラッグで列の入れ替え・右クリックで隠す・幅・色など`;
      return `<th data-col="${esc(c)}" draggable="true" class="${c === V.lotCol ? "ll-lotcol " : ""}${calc ? "is-calc " : ""}${sorted ? "is-sorted " : ""}al-h-${al.head}"${sorted ? ` data-sort="${sorted}"` : ""} title="${esc(tip)}">`
        + `<i class="col-grip" aria-hidden="true">⠿</i><span class="th-in"><span>${esc(LC().label(t, c))}</span>${sorted ? `<i class="lv-sort">${sorted === "asc" ? "▲" : "▼"}</i>` : ""}</span>`
        + `<i class="col-resize${L.locks.includes(c) ? " is-locked" : ""}" title="${L.locks.includes(c) ? "この列は幅を固定しています（表示列で解けます）" : "ドラッグで列幅を調整（ダブルクリックで自動）"}"></i></th>`;
    }).join("") + "</tr>";
    if (!V.bound) { LC().bindHeader($("lvHead")); V.bound = true; }
    V.shown = { rows, cols, aligns: cols.map((c) => LC().alignOf(t, c).data) };
    paintBody(true);
    $("lvTint").textContent = LC().tintCss(t, cols, "#lvGrid") + LC().freezeCss("#lvGrid", widths);
    $("lvCount").textContent = `${fmtN(rows.length)}${rows.length !== V.lots.length ? ` / ${fmtN(V.lots.length)}` : ""} ロット・${cols.length} 列`;
  }

  // 行だけを描き直す（値が届いたとき。検索・並べ替えは全部の行にかけ直し、見えている行だけを描く）
  function refreshRows() {
    if (!V.shown) { render(); return; }
    const rows = viewRows(V.shown.cols);
    V.shown = { ...V.shown, rows };
    paintBody(true);
    $("lvCount").textContent = `${fmtN(rows.length)}${rows.length !== V.lots.length ? ` / ${fmtN(V.lots.length)}` : ""} ロット・${V.shown.cols.length} 列`;
  }
  // 表の体は、見えている行（と前後 OVER 行）だけを描き、上下は高さだけの行で埋める（数千ロットでも、値が届くたびの描き直しと送りが軽い）。
  // 書き出し・検索・並べ替えは全部の行（V.shown.rows）で行う
  const OVER = 40;
  function paintBody(force) {
    const sh = V.shown; if (!sh) return;
    const wrap = $("lvWrap"), body = $("lvBody"), t = TARGET, { rows, cols, aligns } = sh;
    const rh = V.rowH || 30, top = wrap.scrollTop, head = $("lvHead").offsetHeight;
    const a = Math.max(0, Math.floor((top - head) / rh) - OVER), b = Math.min(rows.length, Math.ceil((top + wrap.clientHeight) / rh) + OVER);
    if (!force && V.win && V.win[0] === a && V.win[1] === b) return;
    V.win = [a, b];
    const pad = (n) => (n > 0 ? `<tr class="lv-pad" aria-hidden="true"><td colspan="${cols.length}" style="height:${n * rh}px"></td></tr>` : "");
    body.innerHTML = pad(a) + rows.slice(a, b).map((r, k) => {
      const i = a + k, c0 = V.cache.get(r.__path) || {};
      return `<tr data-path="${esc(r.__path)}"${i % 2 ? ' class="is-odd"' : ""} title="ダブルクリックでこのロットの画像を開く">` + cols.map((c, j) => {
        if (!(c in r) && V.byName.has(c) && c !== V.lotCol) return `<td class="lv-wait al-${aligns[j]}">…</td>`;
        const x = LC().cell(t, c, r);
        return `<td class="al-${aligns[j]}${x.color ? " c-" + x.color : ""}" title="${esc(x.raw)}">${c === V.lotCol ? `<b>${esc(x.text)}</b>` : esc(x.text)}${j === 0 && c0.__error ? ` <span class="err" title="${esc(c0.__error)}">（読めません）</span>` : ""}</td>`;
      }).join("") + "</tr>";
    }).join("") + pad(rows.length - b);
    // 行の高さは描いた行で測り直す（字の大きさ・行の余白の設定で変わる）。変わったら描き直す
    const tr = body.querySelector("tr:not(.lv-pad)");
    if (tr && Math.abs(tr.offsetHeight - rh) > 0.5) { V.rowH = tr.offsetHeight; paintBody(true); }
  }

  // ---------------------------------------------------------------- 書き出し（全件・表示列の見え方のまま）
  async function exportAs(kind) {
    const t = TARGET, cols = shownCols();
    if (V.busy) { status("値を読み終えてから書き出します。帯の進みが済むまでお待ちください"); return; }
    const rows = viewRows(cols);
    if (!rows.length) { status("書き出す行がありません（検索を確かめてください）"); return; }
    const head = cols.map((c) => LC().label(t, c));
    const body = rows.map((r) => cols.map((c) => (c === V.lotCol ? String(r[c] ?? "") : LC().cell(t, c, r).text)));
    const p2 = (n) => String(n).padStart(2, "0"), d = new Date();
    const stem = `ロット表_${(V.scope ? V.scope.crumbs.map((c) => c.label).join("_") : "").replace(/[\\/:*?"<>|\s]+/g, "")}_${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
    if (kind === "csv") {
      const csv = "﻿" + [head, ...body].map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
      TPA.download(new Blob([csv], { type: "text/csv" }), stem + ".csv");
      return;
    }
    const cond = [["範囲", V.scope ? V.scope.crumbs.map((c) => c.label).join(" › ") : ""], ["検索", V.q || "（なし）"],
      ["並び", V.sort.col ? `${LC().label(t, V.sort.col)} ${V.sort.dir === 1 ? "小さい順" : "大きい順"}` : "（新しいロットから）"],
      ["出力した行", `${rows.length.toLocaleString()} 行`], ["出力した日時", `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`]];
    const bytes = await window.XlsxWriter.build([{ name: "ロット表", rows: [head, ...body] }, { name: "出力の条件", header: false, rows: cond }]);
    TPA.download(new Blob([bytes], { type: window.XlsxWriter.MIME }), stem + ".xlsx");
  }
  const status = (m) => (window.dtStatus ? window.dtStatus(m, true) : null);

  window.DTLotList = { mount, setScope, render, scope: () => V.scope, _rows: () => rowsAll() };
})();
