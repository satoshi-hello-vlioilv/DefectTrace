// 欠陥のフィルタ（ロットの画像一覧を DETECT_INFO の項目で絞る。条件の置き場・当て方は desktop/src/filters.rs）。
// 形は 3 回の案出しと別のエージェントの採点で決めた（F4c: program/tools/proposals/2026-10-27-defect-filter*）:
//   画像一覧の上の帯 = 使っている条件のチップ（中身つき・× で外す。1 段に入りきらなければ、チップを帯の 2 段目へ折り返す）・
//   「条件 ▾」（登録した条件をチェックで重ねる小窓）・「⚲ 作る・管理…」（窓: 左に既定／共有／自分の条件と枚数、右に作る所・分布・当てはまる見本）・
//   表示している枚数・外す。重ねた条件は、どれも満たす欠陥の画像だけを出す。使っている条件はこの PC に覚える
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const SC = { def: "既定", share: "共有", mine: "自分" };
  const SC_LONG = { def: "既定（開発者が決めた）", share: "共有（だれでも）", mine: "自分（この PC）" };
  const OPS = [[">=", "≥"], ["<=", "≤"], ["=", "="], ["!=", "≠"], ["between", "範囲"], ["in", "のどれか"]];
  const opText = Object.fromEntries(OPS);
  const ACTIVE = "dtActiveFilters";
  async function call(url, opt) {
    const r = await fetch(url, opt);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `${r.status} ${r.statusText}`);
    return j;
  }
  const post = (url, body, method = "POST") => call(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const q = (o) => new URLSearchParams(o).toString();
  const keyOf = (f) => `${f.scope}:${f.id}`;

  const F = { list: [], me: {}, problems: [], active: [], fields: [], fieldsLot: "", counts: new Map(), countsLot: "", temp: null, edit: null, hist: null };
  try { F.active = JSON.parse(localStorage.getItem(ACTIVE) || "[]"); } catch (_) { F.active = []; }
  const saveActive = () => { try { localStorage.setItem(ACTIVE, JSON.stringify(F.active)); } catch (_) { /* 覚えられなくても使える */ } };
  const activeFilters = () => [...F.list.filter((f) => F.active.includes(keyOf(f))), ...(F.temp ? [F.temp] : [])];
  const canWrite = (f) => f.scope !== "def" || F.me.developer;

  // ---------------------------------------------------------------- 条件の字（項目の表示名・分類と面の名前）
  const fieldLabel = (name) => (F.fields.find((x) => x.name === name) || {}).label || name;
  function valueText(field, v) {
    const ctx = window.dtFilter.ctx() || {};
    const name = (x) => (field === "kindID" ? ctx.kinds?.[String(x)]?.name : field === "group" ? ctx.sides?.[String(x)]?.name : null) ?? x;
    return Array.isArray(v) ? v.map(name).join("・") : name(v);
  }
  const condText = (c) => (c.op === "in" ? `${fieldLabel(c.field)}が ${valueText(c.field, c.v)}${Array.isArray(c.v) && c.v.length > 1 ? " のどれか" : ""}`
    : c.op === "between" ? `${fieldLabel(c.field)} ${c.v}〜${c.v2}` : `${fieldLabel(c.field)} ${opText[c.op] || c.op} ${valueText(c.field, c.v)}`);
  const filterText = (f) => (f.conds || []).map(condText).join(f.all === false ? " または " : " かつ ");

  // ---------------------------------------------------------------- 読み込み・当てる
  async function loadList() {
    try { const r = await call("/api/filters"); F.list = r.filters || []; F.me = r.me || {}; F.problems = r.problems || []; } catch (e) { F.problems = [e.message]; }
    F.active = F.active.filter((k) => F.list.some((f) => keyOf(f) === k));
    saveActive();
  }
  async function loadFields(ctx) {
    if (!ctx || F.fieldsLot === ctx.lot) return;
    try { F.fields = (await call("/api/filters/fields?" + q({ lot: ctx.lot }))).fields || []; F.fieldsLot = ctx.lot; } catch (_) { F.fields = []; }
  }
  let applying = 0;
  async function apply() {
    const ctx = window.dtFilter.ctx(), fs = activeFilters(), my = ++applying;
    renderBar();
    if (!ctx) return;
    if (!fs.length) { window.dtFilter.set(null, ctx.gen); renderBar(); return; }
    try {
      const r = await post("/api/filters/apply", { lot: ctx.lot, g: ctx.g, filters: fs });
      if (my !== applying) return;
      window.dtFilter.set({ keys: r.keys, detects: r.detects, n: fs.length }, ctx.gen);
    } catch (e) { $("fCount").textContent = `絞れません: ${e.message}`; }
    renderBar();
  }
  // 登録した条件ごとの枚数（このロット。小窓・窓を開いたときに数える）
  async function loadCounts() {
    const ctx = window.dtFilter.ctx();
    if (!ctx) return;
    if (F.countsLot !== ctx.lot + "|" + ctx.g) { F.counts = new Map(); F.countsLot = ctx.lot + "|" + ctx.g; }
    await Promise.all(F.list.filter((f) => !F.counts.has(keyOf(f))).map(async (f) => {
      try { F.counts.set(keyOf(f), (await post("/api/filters/apply", { lot: ctx.lot, g: ctx.g, filters: [f] })).nimg); } catch (_) { F.counts.set(keyOf(f), null); }
    }));
  }

  // ---------------------------------------------------------------- 帯（チップ・数）
  function chip(f) {
    const temp = f === F.temp;
    return `<span class="f-chip" title="${esc(filterText(f))}"><span class="f-sc ${temp ? "tmp" : f.scope}">${temp ? "今だけ" : SC[f.scope]}</span><b>${esc(f.name)}</b>`
      + `<span class="c">（${esc(filterText(f))}）</span><button type="button" class="x" data-off="${esc(temp ? "temp" : keyOf(f))}" title="この条件を外す" aria-label="${esc(f.name)} を外す">×</button></span>`;
  }
  function renderBar() {
    const fs = activeFilters(), ctx = window.dtFilter.ctx();
    $("fChips").innerHTML = fs.length ? fs.map(chip).join("") : '<span class="f-none">なし（全部の画像を出しています）</span>';
    $("fClear").hidden = !fs.length;
    $("fCount").innerHTML = ctx && fs.length ? `<b>${window.dtFilter.shownCount()}</b> / ${ctx.total} 枚` : ctx ? `${ctx.total} 枚` : "";
    fitChips();
  }
  // 1 段に入りきらなければ、チップを帯の 2 段目へ折り返す（名前・中身・× を切らない。作った後の採点 2026-10-27: 畳むと中身と × が消えた）
  function fitChips() {
    const bar = $("fBar"), box = $("fChips");
    bar.classList.remove("two");
    if (box.querySelector(".f-chip") && box.scrollWidth > box.clientWidth) bar.classList.add("two");
  }

  // ---------------------------------------------------------------- 登録した条件の並び（小窓と窓で同じ形）
  function libHtml(withTools) {
    if (!F.list.length && !F.problems.length) return '<div class="f-hint">登録した条件はまだありません。「⚲ 作る・管理…」で作ります</div>';
    return ["def", "share", "mine"].map((sc) => {
      const fs = F.list.filter((f) => f.scope === sc);
      return `<div class="f-sec"><div class="f-sech"><span class="f-sc ${sc}">${SC[sc]}</span>${esc(SC_LONG[sc].slice(3, -1))}</div>` + (fs.length ? fs.map((f) => {
        const k = keyOf(f), n = F.counts.get(k);
        return `<label class="f-item" title="${esc(filterText(f))}"><input type="checkbox" data-on="${esc(k)}" ${F.active.includes(k) ? "checked" : ""}>
          <span class="nm">${esc(f.name)}</span><span class="f-hint ct">${esc(filterText(f))}</span><span class="f-n">${n == null ? "" : `${n} 枚`}</span>
          ${withTools && canWrite(f) ? `<button type="button" class="f-mini" data-edit="${esc(k)}" title="直す">✎</button><button type="button" class="f-mini del" data-del="${esc(k)}" title="消す">×</button>` : ""}</label>`;
      }).join("") : '<div class="f-hint f-empty">なし</div>') + "</div>";
    }).join("") + (F.problems.length ? `<div class="f-hint f-err">${esc(F.problems.join(" / "))}</div>` : "");
  }
  async function openPick() {
    const pop = $("fPop");
    if (!pop.hidden) { pop.hidden = true; return; }
    const draw = () => { pop.innerHTML = `<b>登録した条件（チェックで重ねる）</b>${libHtml(false)}<div class="f-hint">チェックした条件を、どれも満たす欠陥の画像だけを出します</div>`; };
    draw(); pop.hidden = false;
    await loadCounts();   // 条件ごとの枚数が分かったら描き直す
    if (!pop.hidden) draw();
  }

  // ---------------------------------------------------------------- 窓（登録した条件・作る所）
  const blank = () => ({ id: "", name: "", all: true, conds: [{ field: F.fields.find((x) => x.name === "length_mm") ? "length_mm" : (F.fields[0] || {}).name || "", op: ">=", v: "" }] });
  async function openWin(edit) {
    const ctx = window.dtFilter.ctx();
    await loadFields(ctx);
    F.edit = edit ? JSON.parse(JSON.stringify(edit)) : F.edit || blank();
    F.editScope = edit ? edit.scope : F.editScope || "mine";
    $("fModal").hidden = false;
    renderWin();
    await loadCounts();
    renderLib();
    preview();
  }
  const renderLib = () => { $("fLib").innerHTML = `<b>登録した条件（チェックで重ねる）</b>${libHtml(true)}<div class="f-hint">チェックした条件を、どれも満たす欠陥の画像だけを出します</div>`; };
  function fieldOptions(sel) {
    return F.fields.map((x) => `<option value="${esc(x.name)}" ${x.name === sel ? "selected" : ""}>${esc(x.label)}</option>`).join("") || `<option value="${esc(sel)}">${esc(sel)}</option>`;
  }
  function valueInput(c, i) {
    const ctx = window.dtFilter.ctx() || {};
    const names = c.field === "kindID" ? ctx.kinds : c.field === "group" ? ctx.sides : null;
    if (c.op === "in" && names) {
      const vs = Array.isArray(c.v) ? c.v.map(Number) : [];
      return `<span class="f-ins">${Object.entries(names).map(([k, v]) => `<label><input type="checkbox" data-in="${i}" value="${esc(k)}" ${vs.includes(Number(k)) ? "checked" : ""}>${esc(v.name || k)}</label>`).join("")}</span>`;
    }
    if (c.op === "in") return `<input type="text" data-c="${i}" data-k="vlist" value="${esc((Array.isArray(c.v) ? c.v : []).join(","))}" placeholder="1,2,3" style="width:110px">`;
    return `<input type="number" step="any" data-c="${i}" data-k="v" value="${esc(c.v ?? "")}" style="width:80px">${c.op === "between" ? ` 〜 <input type="number" step="any" data-c="${i}" data-k="v2" value="${esc(c.v2 ?? "")}" style="width:80px">` : ""}`;
  }
  function renderWin() {
    const f = F.edit, dev = !!F.me.developer;
    $("fEd").innerHTML = `
      <div class="f-r"><h4 style="flex:1">${f.id ? "条件を直す" : "新しい条件を作る"}</h4><button type="button" class="f-btn" data-new>＋ 新しく</button></div>
      <div class="f-r"><span class="f-k">名前</span><input type="text" id="fName" value="${esc(f.name)}" placeholder="例: 長い穴" style="width:240px"></div>
      <div class="f-rows">${f.conds.map((c, i) => `<div class="f-r"><select data-c="${i}" data-k="field">${fieldOptions(c.field)}</select>
        <select data-c="${i}" data-k="op">${OPS.map(([o, t]) => `<option value="${o}" ${o === c.op ? "selected" : ""}>${t}</option>`).join("")}</select>${valueInput(c, i)}
        <button type="button" class="f-mini del" data-rm="${i}" title="この条件を外す">×</button></div>`).join("")}
        <div class="f-r"><button type="button" class="f-btn" data-add>＋ 条件</button><select id="fAll" ${f.conds.length > 1 ? "" : "hidden"} title="条件のつなぎ方"><option value="1" ${f.all !== false ? "selected" : ""}>すべて満たす（かつ）</option><option value="0" ${f.all === false ? "selected" : ""}>どれか（または）</option></select></div></div>
      <div class="f-hint" id="fHistT"></div><div class="f-hist" id="fHist"></div>
      <div class="f-r"><span class="f-k">置き場</span><span class="f-scope">
        <label><input type="radio" name="fsc" value="mine" ${F.editScope === "mine" ? "checked" : ""}><span class="f-sc mine">自分</span>この PC</label>
        <label><input type="radio" name="fsc" value="share" ${F.editScope === "share" ? "checked" : ""}><span class="f-sc share">共有</span>だれでも</label>
        <label class="${dev ? "" : "no"}" title="${dev ? "全員の既定の条件として保存します" : "既定の条件は開発者だけが保存できます"}"><input type="radio" name="fsc" value="def" ${dev ? "" : "disabled"} ${F.editScope === "def" ? "checked" : ""}><span class="f-sc def">既定</span>開発者だけ</label></span></div>
      <div class="f-r"><span class="f-n" id="fLive"></span></div><div class="f-prev" id="fPrev"></div>
      <div class="f-r" style="justify-content:flex-end"><span class="f-err" id="fErr"></span><button type="button" class="f-btn" data-temp>絞るだけ（保存しない）</button><button type="button" class="f-btn f-pri" data-save>保存</button></div>`;
    hist();
  }
  // 作っている条件を、窓の部品から読む
  function readEdit() {
    const f = F.edit;
    f.name = $("fName").value.trim();
    f.all = $("fAll").value === "1";
    $("fEd").querySelectorAll("[data-c]").forEach((el) => {
      const c = f.conds[+el.dataset.c], k = el.dataset.k;
      if (k === "vlist") c.v = el.value.split(/[,\s]+/).filter(Boolean).map(Number);
      else if (k === "v" || k === "v2") c[k] = el.value === "" ? "" : +el.value;
      else c[k] = el.value;
    });
    f.conds.forEach((c, i) => { const ins = [...$("fEd").querySelectorAll(`[data-in="${i}"]`)]; if (ins.length) c.v = ins.filter((x) => x.checked).map((x) => +x.value); });
    F.editScope = ($("fEd").querySelector('input[name="fsc"]:checked') || {}).value || "mine";
    return f;
  }
  const ready = (f) => f.conds.length && f.conds.every((c) => c.field && (c.op === "in" ? Array.isArray(c.v) && c.v.length : c.v !== "" && (c.op !== "between" || c.v2 !== "")));
  let previewTimer = null;
  function preview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      const ctx = window.dtFilter.ctx(), f = readEdit();
      if (!ctx) { $("fLive").textContent = "ロットを開くと、当てはまる画像の数が出ます"; return; }
      if (!ready(f)) { $("fLive").textContent = "条件の値を入れると、当てはまる画像の数が出ます"; $("fPrev").innerHTML = ""; return; }
      try {
        const r = await post("/api/filters/apply", { lot: ctx.lot, g: ctx.g, filters: [{ ...f, name: f.name || "（名前なし）" }] });
        $("fLive").innerHTML = `当てはまる画像 <b>${r.nimg}</b> / ${ctx.total} 枚（欠陥 ${r.ndet} / ${r.totaldet}）`;
        $("fPrev").innerHTML = r.keys.slice(0, 8).map((k) => { const [cab, ...n] = k.split("/"); return `<img alt="" src="/thumb?${q({ lot: ctx.lot, g: ctx.g, cab, name: n.join("/") })}">`; }).join("");
      } catch (e) { $("fLive").textContent = e.message; }
      hist();
    }, 250);
  }
  // 1 つ目の数の条件の項目の分布（このロット）。当てはまる所を濃く
  async function hist() {
    const ctx = window.dtFilter.ctx(), c = (F.edit.conds || []).find((x) => x.op !== "in" && x.field);
    if (!ctx || !c) { $("fHist").innerHTML = ""; $("fHistT").textContent = ""; return; }
    const keyh = ctx.lot + "|" + c.field;
    if (!F.hist || F.hist.key !== keyh) { try { F.hist = { key: keyh, ...(await call("/api/filters/hist?" + q({ lot: ctx.lot, field: c.field }))) }; } catch (_) { return; } }
    const h = F.hist, max = Math.max(1, ...h.bins), w = h.bins.length ? (h.max - h.min) / h.bins.length : 1;
    const inn = (x) => (c.v === "" ? false : c.op === ">=" ? x >= c.v : c.op === "<=" ? x <= c.v : c.op === ">" ? x > c.v : c.op === "<" ? x < c.v : c.op === "between" ? x >= c.v && x <= c.v2 : c.op === "=" ? Math.abs(x - c.v) < w : c.op === "!=" ? Math.abs(x - c.v) >= w : false);
    $("fHistT").textContent = h.n ? `${fieldLabel(c.field)} の分布（このロット ${fmt(h.min)}〜${fmt(h.max)}・濃い所が当てはまる）` : `${fieldLabel(c.field)}: このロットに値がありません`;
    $("fHist").innerHTML = h.bins.map((n, i) => `<i class="${inn(h.min + (i + 0.5) * w) ? "in" : ""}" style="height:${Math.max(n ? 2 : 0, Math.round((n / max) * 44))}px" title="${fmt(h.min + i * w)}〜${fmt(h.min + (i + 1) * w)}: ${n}"></i>`).join("");
  }
  const fmt = (x) => (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 1 ? x.toFixed(1) : x.toFixed(3));

  // ---------------------------------------------------------------- 操作
  function toggle(k, on) {
    F.active = on ? [...new Set([...F.active, k])] : F.active.filter((x) => x !== k);
    saveActive(); apply();
  }
  document.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.closest("#fPick")) { openPick(); return; }
    if (t.closest("#fOpen")) { $("fPop").hidden = true; openWin(); return; }
    if (t.closest("#fClear")) { F.active = []; F.temp = null; saveActive(); apply(); return; }
    const off = t.closest("[data-off]");
    if (off) { if (off.dataset.off === "temp") { F.temp = null; apply(); } else toggle(off.dataset.off, false); return; }
    if (!$("fPop").hidden && !t.closest("#fPop")) $("fPop").hidden = true;
    if (!t.closest("#fModal")) return;
    if (t.closest("#fClose") || t.id === "fModal") { $("fModal").hidden = true; return; }
    const ed = t.closest("[data-edit]"), del = t.closest("[data-del]");
    if (ed) { e.preventDefault(); const f = F.list.find((x) => keyOf(x) === ed.dataset.edit); if (f) { F.edit = JSON.parse(JSON.stringify(f)); F.editScope = f.scope; renderWin(); preview(); } return; }
    if (del) {
      e.preventDefault();
      if (del.dataset.armed !== "1") { del.dataset.armed = "1"; del.textContent = "もう一度押すと消す"; setTimeout(() => { del.dataset.armed = ""; del.textContent = "×"; }, 4000); return; }
      const [scope, ...id] = del.dataset.del.split(":");
      try { await call("/api/filters?" + q({ scope, id: id.join(":") }), { method: "DELETE" }); await loadList(); F.counts.delete(del.dataset.del); renderLib(); apply(); } catch (err) { $("fErr").textContent = err.message; }
      return;
    }
    if (t.closest("[data-new]")) { F.edit = blank(); renderWin(); preview(); return; }
    if (t.closest("[data-add]")) { readEdit(); F.edit.conds.push({ field: (F.fields[0] || {}).name || "", op: ">=", v: "" }); renderWin(); return; }
    const rm = t.closest("[data-rm]");
    if (rm) { readEdit(); F.edit.conds.splice(+rm.dataset.rm, 1); if (!F.edit.conds.length) F.edit = blank(); renderWin(); preview(); return; }
    if (t.closest("[data-temp]")) {
      const f = readEdit();
      if (!ready(f)) { $("fErr").textContent = "条件の値を入れてください"; return; }
      F.temp = { ...JSON.parse(JSON.stringify(f)), name: f.name || "今だけの条件", scope: "temp" };
      $("fModal").hidden = true; apply(); return;
    }
    if (t.closest("[data-save]")) {
      const f = readEdit();
      try {
        const saved = await post("/api/filters", { scope: F.editScope, filter: f });
        await loadList();
        F.counts.delete(keyOf(saved));
        F.active = [...new Set([...F.active, keyOf(saved)])]; saveActive();
        F.edit = blank(); $("fModal").hidden = true; apply();
      } catch (err) { $("fErr").textContent = err.message; }
    }
  });
  document.addEventListener("change", (e) => {
    const on = e.target.closest("[data-on]");
    if (on) { toggle(on.dataset.on, on.checked); document.querySelectorAll(`[data-on="${CSS.escape(on.dataset.on)}"]`).forEach((x) => { x.checked = on.checked; }); return; }
    if (e.target.closest("#fEd")) {
      const k = e.target.dataset.k;
      if (k === "field" || k === "op") { readEdit(); const c = F.edit.conds[+e.target.dataset.c]; if (k === "op" && c.op === "in") c.v = []; renderWin(); }
      preview();
    }
  });
  document.addEventListener("input", (e) => { if (e.target.closest("#fEd")) preview(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("fModal").hidden) { $("fModal").hidden = true; e.stopPropagation(); }
    else if (!$("fPop").hidden) { $("fPop").hidden = true; e.stopPropagation(); }
  }, true);
  window.addEventListener("resize", fitChips);

  // ロットを開いて対応付けが済んだら、使っている条件を当て直す（項目の名前もそのロットの物に）
  window.dtFilter.onReady(async () => { F.counts = new Map(); renderBar(); await loadFields(window.dtFilter.ctx()); apply(); });
  loadList().then(renderBar);
})();
