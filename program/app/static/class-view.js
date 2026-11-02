// 画像の仕分け（グループを作り、見本の画像を 3 枚以上ドラッグ＆ドロップで登録 → 裏〈/api/classify〉が見本とロットの画像の特徴
// 〈画像の明るさ・欠陥の形と大きさ・欠陥データの項目〉から振り分けの条件を割り出し、ロットの画像を振り分ける。desktop/src/classify.rs）。
// 形は 3 回の案出しと別のエージェントの採点で L に決めた（program/tools/proposals/2026-11-02-classify*）:
//   左の欄の木のすぐ下に、グループの行（カードのドロップ先・記号と色・見本 n/3・当てはまる枚数・条件 1 行）。行を押すと一覧をそのグループに絞り、
//   絞り込みはフィルタの帯にも札で出す（同じ「絞る」は同じ置き場・同じ形）。一覧の並び（CAB 順／グループ順）は仕分けの欄の中。
//   色は表裏（赤・青）・分類（赤・青・緑・橙）と重ならない色に記号を添える（色だけで区別しない）。札は 見本＝塗り・当てはまる＝枠。
// グループは この PC の作業場所の classes.json に残す。見本は特徴の値ごと残すので、ほかのロットにも使える。
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const q = (o) => new URLSearchParams(o).toString();
  const NEED = 3;   // 条件を割り出す見本の数（裏の classify::MIN_EXAMPLES と同じ）
  // グループの色と記号（表裏・分類の色と重ならない）
  const LOOK = [["#7b3fb0", "◆"], ["#0f766e", "▼"], ["#9d174d", "⬟"], ["#475569", "✚"], ["#92400e", "⬢"], ["#4338ca", "✱"]];
  const DT = "application/x-dt-img";
  const C = { groups: [], res: null, on: null, sort: localStorage.getItem("clsSort") || "cab", running: 0, del: null, edit: null, err: "" };

  async function api(url, opt) {
    const r = await fetch(url, opt);
    const t = await r.text();
    let d; try { d = JSON.parse(t); } catch (_) { d = { error: t }; }
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return d;
  }
  const post = (url, body) => api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const ctx = () => window.dtClass.ctx();
  const look = (g) => LOOK[(g.look ?? 0) % LOOK.length];
  const resOf = (g) => C.res?.groups.find((r) => r.id === g.id);
  const isExample = (g, c, key) => g.examples.some((e) => e.lot === c.lot && e.g === c.g && e.key === key);

  // ---------------------------------------------------------------- 残す・当てる
  async function load() {
    try { C.groups = (await api("/api/classes")).groups || []; } catch (e) { C.err = `グループを読めません: ${e.message}`; }
    render();
  }
  async function save() {
    try { await post("/api/classes", { groups: C.groups }); C.err = ""; } catch (e) { C.err = `グループを残せません: ${e.message}`; }
  }
  /** 条件を割り出し、ロットの画像を振り分ける（グループが変わるたび・ロットを開くたび） */
  async function run() {
    const c = ctx(), my = ++C.running;
    if (!c || !C.groups.length) { C.res = null; after(c); return; }
    render(true);
    try {
      const r = await post("/api/classify", { lot: c.lot, g: c.g, groups: C.groups.map((g) => ({ id: g.id, examples: g.examples.map((e) => ({ feat: e.feat })) })) });
      if (my !== C.running || c.gen !== ctx()?.gen) return;
      C.res = r; C.err = "";
    } catch (e) { if (my === C.running) { C.res = null; C.err = `振り分けられません: ${e.message}`; } }
    after(c);
  }
  function after(c) {
    if (C.on && !C.groups.some((g) => g.id === C.on)) C.on = null;
    applyFilter(c);
    window.dtClass.refresh();
    render();
    applySort();
  }
  /** 絞っているグループの画像（当てはまる・見本）。一覧・送り・MAP・CAB の見出しの数は app.js がフィルタと重ねて当てる */
  function applyFilter(c = ctx()) {
    if (!c) return;
    const g = C.groups.find((x) => x.id === C.on);
    if (!g) { window.dtClass.set(null, "", c.gen); return; }
    const keys = Object.entries(C.res?.assign || {}).filter(([, a]) => a.g === g.id && a.hit).map(([k]) => k);
    for (const e of g.examples) if (e.lot === c.lot && e.g === c.g && !keys.includes(e.key)) keys.push(e.key);
    window.dtClass.set(keys, `${look(g)[1]} ${g.name}`, c.gen);
  }

  // ---------------------------------------------------------------- app.js から呼ばれる（カードの札・帯の札・外す）
  window.dtClass.tag = (key) => {
    const c = ctx(); if (!c) return "";
    for (const g of C.groups) {
      const [col, mk] = look(g);
      if (isExample(g, c, key)) return `<span class="ctag ex" style="--gc:${col}" title="${esc(g.name)} の見本">${mk} ${esc(g.name)} 見本</span>`;
    }
    const a = C.res?.assign?.[key];
    const g = a && a.hit && C.groups.find((x) => x.id === a.g);
    if (!g) return "";
    const [col, mk] = look(g);
    return `<span class="ctag" style="--gc:${col}" title="${esc(g.name)} に当てはまる（${esc(ruleText(g))}）">${mk} ${esc(g.name)}</span>`;
  };
  window.dtClass.chip = () => {
    const g = C.groups.find((x) => x.id === C.on);
    if (!g) return "";
    const [col, mk] = look(g);
    return `<span class="f-chip cls-chip" style="--gc:${col}" title="仕分けで絞っています（${esc(ruleText(g))}）"><span class="mk">${mk}</span>仕分け: <b>${esc(g.name)}</b><button type="button" class="x" data-cls-off title="仕分けの絞り込みを外す">×</button></span>`;
  };
  window.dtClass.clear = () => { C.on = null; applyFilter(); render(); };
  document.addEventListener("click", (e) => { if (e.target.closest("[data-cls-off]")) { e.stopPropagation(); window.dtClass.clear(); } }, true);

  const ruleText = (g) => {
    const r = resOf(g);
    if (g.examples.length < NEED) return `見本をあと ${NEED - g.examples.length} 枚（${NEED} 枚で条件を割り出します）`;
    if (!r) return C.running ? "条件を割り出しています…" : "";
    return r.rules.length ? r.rules.map((x) => x.text).join(" かつ ") : r.why || "";
  };

  // ---------------------------------------------------------------- 欄を描く
  function render(busy) {
    const c = ctx();
    const rows = C.groups.map((g) => {
      const [col, mk] = look(g), r = resOf(g), on = C.on === g.id;
      const hit = r ? r.hit : 0;
      const ex = g.examples.slice(0, 8).map((e, i) => {
        const [cab, ...rest] = e.key.split("/");
        const here = c && e.lot === c.lot && e.g === c.g;
        return `<span class="cls-exi${here ? "" : " other"}" title="${esc(here ? e.key : `${e.key}（ほかのロット: ${e.lot.split(/[\\/]/).pop()}）`)}"><img alt="" loading="lazy" src="/thumb?${esc(q({ lot: e.lot, g: e.g, cab, name: rest.join("/") }))}"><button type="button" data-rmex="${i}" title="この見本を外す">×</button></span>`;
      }).join("") + (g.examples.length > 8 ? `<span class="cls-more">＋${g.examples.length - 8}</span>` : "");
      const name = C.edit === g.id
        ? `<input class="cls-name" data-name value="${esc(g.name)}" maxlength="24" aria-label="グループの名前">`
        : `<b class="nm" title="ダブルクリックで名前を直す">${esc(g.name)}</b>`;
      const del = C.del === g.id ? `<button type="button" class="cls-x yes" data-del title="もう一度押すと消します">消す？</button>` : `<button type="button" class="cls-x" data-del title="グループを消す">×</button>`;
      return `<div class="cls-g${on ? " on" : ""}" data-gid="${esc(g.id)}" style="--gc:${col}" role="button" tabindex="0" aria-pressed="${on}" title="押すと一覧をこのグループに絞る（もう一度で外す）・カードをここへドラッグで見本に">
        <span class="mk">${mk}</span>${name}<span class="n">見本 ${g.examples.length}/${NEED} ・ ${hit} 枚</span>${del}
        ${ex ? `<span class="cls-ex">${ex}</span>` : ""}<span class="rule${g.examples.length < NEED ? " need" : ""}">${esc(ruleText(g))}</span></div>`;
    }).join("");
    const empty = !C.groups.length;
    $("clsPane").innerHTML = `<div class="cls-head"><b>仕分け</b><span class="sub">${empty ? "似た欠陥の画像をまとめる" : "カードをグループへドラッグ・行を押すと絞る"}</span>${busy ? '<span class="cls-busy">割り出し中…</span>' : ""}</div>
      ${rows ? `<div class="cls-list">${rows}</div>` : ""}
      <div class="cls-add" data-new role="button" tabindex="0" title="カードをここへドラッグしても作れます">＋ グループを作る</div>
      ${C.err ? `<div class="cls-err" role="alert">${esc(C.err)}</div>` : ""}
      <div class="cls-sort">一覧の並び <span class="seg"><button type="button" data-sort="cab" class="${C.sort === "cab" ? "on" : ""}">CAB 順</button><button type="button" data-sort="group" class="${C.sort === "group" ? "on" : ""}">グループ順</button></span></div>
      ${C.groups.every((g) => g.examples.length < NEED) ? `<ol class="cls-how"><li>「＋ グループを作る」で名前を付ける（カードを「＋」へドラッグしても作れます）</li><li>似た欠陥の画像のカードを、${NEED} 枚以上グループの行へドラッグ</li><li>見本に共通する特徴から条件を割り出し、当てはまる画像に札が付く。行を押すと一覧をそのグループに絞る</li></ol>` : ""}`;
    const inp = $("clsPane").querySelector("[data-name]");
    if (inp) { inp.focus(); inp.select(); }
  }

  // ---------------------------------------------------------------- 一覧の並び（グループ順）: カードは動かさず、並びの番号（CSS の order）で並べる
  let mo = null;
  function applySort() {
    const grid = $("grid"), c = ctx();
    grid.querySelectorAll(":scope>.gsep").forEach((x) => x.remove());
    mo?.disconnect();
    const on = C.sort === "group" && c && C.groups.length;
    grid.classList.toggle("gmode", !!on);
    if (!on) { grid.querySelectorAll(":scope>.th").forEach((t) => (t.style.order = "")); return; }
    const idx = window.dtClass.order(), gi = new Map(C.groups.map((g, i) => [g.id, i]));
    const groupOf = (key) => {
      for (const g of C.groups) if (isExample(g, c, key)) return gi.get(g.id);
      const a = C.res?.assign?.[key];
      return a && a.hit && gi.has(a.g) ? gi.get(a.g) : C.groups.length;
    };
    const count = new Map();   // グループ → { n, cabs }
    const place = (t) => {
      const k = t.dataset.key, key = k.slice(k.indexOf("/") + 1), g = groupOf(key);
      t.style.order = g * 1e6 + (idx.get(key) ?? 0) + 1;
      return [g, key];
    };
    for (const t of grid.querySelectorAll(":scope>.th")) {
      const [g, key] = place(t);
      if (t.classList.contains("fo")) continue;
      const s = count.get(g) || { n: 0, cabs: new Map() };
      s.n++; const cab = key.split("/")[0]; s.cabs.set(cab, (s.cabs.get(cab) || 0) + 1); count.set(g, s);
    }
    const head = (i, mk, col, name) => {
      const s = count.get(i);
      if (!s) return "";
      const cabs = [...s.cabs].map(([cab, n]) => `${cab}（${n}）`).join("・");
      return `<div class="cabsep gsep" style="order:${i * 1e6}"><span><span class="gmk" style="color:${col}">${mk}</span> ${esc(name)}</span><span class="st done">${s.n}枚</span><span class="gcab">${esc(cabs)}</span></div>`;
    };
    grid.insertAdjacentHTML("afterbegin", C.groups.map((g, i) => head(i, look(g)[1], look(g)[0], g.name)).join("") + head(C.groups.length, "", "", "未分類"));
    // 後から並ぶカード（まだ読み込み中の CAB）にも番号を付ける
    mo = new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains("th")) place(n); });
    mo.observe(grid, { childList: true });
  }
  window.addEventListener("dt:shown", () => { if (C.sort === "group") applySort(); });

  // ---------------------------------------------------------------- 操作
  async function addExample(gid, key) {
    const c = ctx(); if (!c) return;
    const g = C.groups.find((x) => x.id === gid); if (!g) return;
    if (isExample(g, c, key)) return;
    const [cab, ...rest] = key.split("/");
    let f;
    try { f = await api("/api/classify/feat?" + q({ lot: c.lot, g: c.g, cab, name: rest.join("/") })); }
    catch (e) { C.err = `見本にできません: ${e.message}`; render(); return; }
    // 1 枚の画像は 1 つのグループの見本だけ（入れ直したら移す）
    for (const o of C.groups) o.examples = o.examples.filter((e) => !(e.lot === c.lot && e.g === c.g && e.key === key));
    g.examples.push({ lot: c.lot, g: c.g, key, feat: f.feat });
    await save(); run();
  }
  function newGroup() {
    const used = new Set(C.groups.map((g) => g.look));
    const lk = [...LOOK.keys()].find((i) => !used.has(i)) ?? C.groups.length % LOOK.length;
    const g = { id: "g" + Date.now().toString(36), name: `グループ ${C.groups.length + 1}`, look: lk, examples: [] };
    C.groups.push(g);
    return g;
  }
  const pane = $("clsPane");
  pane.addEventListener("click", async (e) => {
    const t = e.target;
    const row = t.closest(".cls-g"), g = row && C.groups.find((x) => x.id === row.dataset.gid);
    if (t.closest("[data-sort]")) { C.sort = t.closest("[data-sort]").dataset.sort; localStorage.setItem("clsSort", C.sort); render(); applySort(); return; }
    if (t.closest("[data-new]")) { const n = newGroup(); C.edit = n.id; await save(); render(); return; }
    if (!g) return;
    if (t.closest("[data-del]")) {
      if (C.del !== g.id) { C.del = g.id; render(); return; }
      C.groups = C.groups.filter((x) => x !== g); C.del = null; if (C.on === g.id) C.on = null;
      await save(); run(); return;
    }
    if (t.closest("[data-rmex]")) { g.examples.splice(+t.closest("[data-rmex]").dataset.rmex, 1); await save(); run(); return; }
    if (t.closest("[data-name]")) return;
    C.del = null;
    C.on = C.on === g.id ? null : g.id;
    applyFilter(); render();
  });
  pane.addEventListener("keydown", (e) => {
    const inp = e.target.closest("[data-name]");
    if (inp && (e.key === "Enter" || e.key === "Escape")) { e.preventDefault(); inp.blur(); return; }
    if ((e.key === "Enter" || e.key === " ") && e.target.matches(".cls-g,.cls-add")) { e.preventDefault(); e.target.click(); }
  });
  pane.addEventListener("dblclick", (e) => { const row = e.target.closest(".cls-g"); if (row && e.target.closest(".nm")) { C.edit = row.dataset.gid; render(); } });
  pane.addEventListener("focusout", async (e) => {
    const inp = e.target.closest("[data-name]"); if (!inp) return;
    const g = C.groups.find((x) => x.id === C.edit);
    if (g && inp.value.trim()) g.name = inp.value.trim();
    C.edit = null; await save(); render(); window.dtClass.refresh(); applySort(); if (C.on) applyFilter();
  });

  // ドラッグ: 一覧のカード → グループの行（見本に）・「＋ グループを作る」（作って見本に）
  $("grid").addEventListener("dragstart", (e) => {
    const th = e.target.closest?.(".th"); if (!th) return;
    const k = th.dataset.key;
    e.dataTransfer.setData(DT, k.slice(k.indexOf("/") + 1));
    e.dataTransfer.setData("text/plain", k.slice(k.indexOf("/") + 1));
    e.dataTransfer.effectAllowed = "copy";
    document.body.classList.add("cls-dragging");
  });
  document.addEventListener("dragend", () => { document.body.classList.remove("cls-dragging"); pane.querySelectorAll(".drop").forEach((x) => x.classList.remove("drop")); });
  const target = (e) => e.target.closest?.(".cls-g,.cls-add");
  pane.addEventListener("dragover", (e) => {
    const z = target(e); if (!z || !e.dataTransfer.types.includes(DT)) return;
    e.preventDefault(); e.dataTransfer.dropEffect = "copy";
    pane.querySelectorAll(".drop").forEach((x) => x !== z && x.classList.remove("drop")); z.classList.add("drop");
  });
  pane.addEventListener("dragleave", (e) => { const z = target(e); if (z && !z.contains(e.relatedTarget)) z.classList.remove("drop"); });
  pane.addEventListener("drop", async (e) => {
    const z = target(e), key = e.dataTransfer.getData(DT); if (!z || !key) return;
    e.preventDefault(); z.classList.remove("drop"); document.body.classList.remove("cls-dragging");
    if (z.matches(".cls-add")) { const g = newGroup(); C.edit = g.id; await addExample(g.id, key); return; }
    await addExample(z.dataset.gid, key);
  });

  window.dtClass.onReady(run);
  load();
})();
