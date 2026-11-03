// 機能ブロックの配置（形は 3 回の案出しと別のエージェントの採点で G3 に決めた: program/tools/proposals/2026-11-02-layout*）。
//   欄（aside.dock: 左・左の 2 列目・右）の中に、ブロック（section.blk: ロット・仕分け・画像情報・MAP・ロット情報）が上から並ぶ。
//   - 見出し: ⠿（つかんでほかの欄・上下へ移す）・▾ 名前（押すとたたむ）・数・⋯（移せる先・たたむ・高さを戻す）
//   - ブロックの間の境目をドラッグで高さ（隣の 2 つの比率を変える）
//   - 上の「画面の配置」: 欄の数（左・中・右／左2列・中・右／左・中／中・右）・よく使う形（標準・仕分けを広く・画像を大きく）・元に戻す（1 つ前の配置）
//   配置はこの PC に残す（localStorage: WebView の作業場所 %LOCALAPPDATA% の下）。欄の幅は app.js の境目（w_<欄の id>）
(() => {
  const $ = (id) => document.getElementById(id);
  const KEY = "dtLayout";
  const COLS = ["left", "col2", "right"];
  const COL_EL = { left: "treePane", col2: "col2", right: "infoPane" };
  const COL_NAME = { left: "左の欄", col2: "左の 2 列目", right: "右の欄" };
  const MODES = {   // 欄の数: 出す欄・絵（欄の幅。0 は中央）
    lcr: { cols: ["left", "right"], name: "左・中・右", ic: [14, 0, 14] },
    llcr: { cols: ["left", "col2", "right"], name: "左2列・中・右", ic: [10, 10, 0, 14] },
    lc: { cols: ["left"], name: "左・中", ic: [14, 0] },
    cr: { cols: ["right"], name: "中・右", ic: [0, 14] },
  };
  const HOME = { tree: "left", cls: "left", img: "right", map: "right", lot: "right" };   // 標準の置き場
  const WEIGHT = { tree: 1, cls: 1.15, img: 0.9, map: 1.6, lot: 0.5 };                  // 標準の高さの比率
  // 標準: 窓の高さが低い（900px 未満）ときは、ロット情報をたたんでおき、画像情報と MAP に高さを回す
  const STD = () => ({ mode: "lcr", place: { left: ["tree", "cls"], col2: [], right: ["img", "map", "lot"] }, w: { ...WEIGHT }, fold: innerHeight < 900 ? { lot: true } : {}, auto: {}, widths: null });
  const PRESETS = {
    std: { name: "標準", make: STD },
    cls: { name: "仕分けを広く", make: () => ({ ...STD(), mode: "llcr", place: { left: ["tree"], col2: ["cls"], right: ["img", "map", "lot"] } }) },
    big: { name: "画像を大きく", make: () => ({ ...STD(), fold: { lot: true }, widths: { treePane: 250, infoPane: 300 } }) },
  };

  // ---------------------------------------------------------------- 見出しを作る（HTML の .blk: data-title と、見出しの右に出す .bn）
  const blocks = {};
  document.querySelectorAll(".dock>.blk").forEach((b) => {
    const id = b.dataset.blk, bn = b.querySelector(":scope>.bn");
    const head = document.createElement("div");
    head.className = "bh";
    head.innerHTML = `<span class="grip" title="つかんで移す（ほかの欄・上下へ）" aria-hidden="true">⠿</span>`
      + `<button type="button" class="bt" aria-expanded="true" title="押すとたたむ・開く"><span class="tw2" aria-hidden="true">▾</span><b>${b.dataset.title}</b></button>`;
    if (bn) head.append(bn); else head.insertAdjacentHTML("beforeend", '<span class="bn"></span>');
    head.insertAdjacentHTML("beforeend", `<span class="bsp"></span><button type="button" class="bmore" aria-haspopup="true" title="移す先・たたむ・高さを戻す" aria-label="${b.dataset.title}の配置">⋯</button>`);
    const body = document.createElement("div");
    body.className = "bb";
    body.append(...b.childNodes);
    b.append(head, body);
    blocks[id] = b;
  });

  // ---------------------------------------------------------------- 配置の読み書き
  function load() {
    let v = null;
    try { v = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (_) { v = null; }
    const L = STD();
    if (!v || typeof v !== "object") return L;
    if (MODES[v.mode]) L.mode = v.mode;
    if (v.place) {   // 知らないブロック・重なりを除き、欠けたブロックは標準の置き場へ
      const seen = new Set();
      for (const c of COLS) L.place[c] = (Array.isArray(v.place[c]) ? v.place[c] : []).filter((id) => blocks[id] && !seen.has(id) && seen.add(id));
      for (const id of Object.keys(blocks)) if (!seen.has(id)) L.place[HOME[id] || "left"].push(id);
    }
    for (const id of Object.keys(WEIGHT)) if (v.w && v.w[id] > 0) L.w[id] = +v.w[id];
    if (v.fold && typeof v.fold === "object") {   // 覚えたたたみ方をそのまま使う（標準のたたみ〈低い窓のロット情報〉を開いたことも残す）
      L.fold = {};
      for (const id of Object.keys(blocks)) if (v.fold[id]) L.fold[id] = true;
    }
    if (v.auto && typeof v.auto === "object") for (const id of Object.keys(blocks)) if (v.auto[id] && L.fold[id]) L.auto[id] = true;
    return L;
  }
  let L = load(), prev = null;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ mode: L.mode, place: L.place, w: L.w, fold: L.fold, auto: L.auto })); } catch (_) { /* 覚えられなくても使える */ } };
  const where = (id) => COLS.find((c) => L.place[c].includes(id));
  const shown = (c) => MODES[L.mode].cols.includes(c);
  // 配置を変える前に 1 つ前を取っておく（「元に戻す」）
  const remember = () => { prev = JSON.parse(JSON.stringify(L)); prev.widths = { treePane: $("treePane").offsetWidth, col2: $("col2").offsetWidth, infoPane: $("infoPane").offsetWidth }; };

  // 欄の数に合わせて、隠れる欄のブロックを残る欄へ寄せ、空の欄には標準でそこに置くブロックを戻す
  function fit() {
    const vis = MODES[L.mode].cols;
    for (const c of COLS) {
      if (vis.includes(c) || !L.place[c].length) continue;
      const to = c === "col2" ? "left" : vis.includes("left") ? "left" : vis[0];
      // 左の欄のブロックが右へ寄るときは上に、それ以外は下に足す（目で見た左右の順を保つ）
      L.place[to] = c === "left" && to === "right" ? [...L.place[c], ...L.place[to]] : [...L.place[to], ...L.place[c]];
      L.place[c] = [];
    }
    for (const c of vis) {
      if (L.place[c].length) continue;
      const want = c === "col2" ? ["cls"] : Object.keys(HOME).filter((id) => HOME[id] === c);
      for (const id of want) {
        const from = where(id);
        if (!from || from === c || L.place[from].length <= 1) continue;   // 元の欄を空にしない
        L.place[from] = L.place[from].filter((x) => x !== id); L.place[c].push(id);
      }
    }
  }

  // ---------------------------------------------------------------- 描く（欄の中にブロックと境目を並べ直す）
  function render() {
    fit();
    const list = document.body.classList.contains("mode-list");
    for (const c of COLS) {
      const col = $(COL_EL[c]);
      col.querySelectorAll(":scope>.hsplit").forEach((x) => x.remove());
      const ids = L.place[c];
      ids.forEach((id) => col.append(blocks[id]));
      // ロット表のときは画像の見方のブロック（画像情報・MAP・ロット情報）を出さない。中身の無い欄は隠す
      const live = ids.filter((id) => !(list && ["img", "map", "lot"].includes(id)));
      ids.forEach((id) => { blocks[id].hidden = list && !live.includes(id); });
      const on = shown(c) && live.length > 0;
      col.hidden = !on;
      const sp = document.querySelector(`.split[data-split="${COL_EL[c]}"]`);
      if (sp) sp.hidden = !on;
      // 開いているブロックどうしの間に境目
      const open = live.filter((id) => !L.fold[id]);
      for (let i = 0; i < live.length - 1; i++) {
        const a = live[i], b = live[i + 1];
        const sp2 = document.createElement("div");
        sp2.className = "hsplit"; sp2.title = "ドラッグで高さを変える（ダブルクリックで元の高さ）";
        sp2.dataset.a = a; sp2.dataset.b = b;
        if (L.fold[a] && L.fold[b]) sp2.classList.add("off");
        blocks[a].after(sp2);
      }
      for (const id of ids) {
        const b = blocks[id], f = !!L.fold[id];
        b.classList.toggle("fold", f);
        b.style.setProperty("--w", L.w[id] || 1);
        b.querySelector(".bt").setAttribute("aria-expanded", String(!f));
        b.querySelector(".tw2").textContent = f ? "▸" : "▾";
        // 欄の中でただ 1 つ開いているブロックは、残りの高さを全部使う
        b.classList.toggle("solo", !f && open.length === 1);
      }
    }
    document.body.dataset.layout = L.mode;
    roomForCenter();
    fitMins();
    window.dispatchEvent(new Event("dt:layout"));
  }
  // 伸びる中身（data-grow="最小の高さ"。MAP の図）を持つブロックは、ほかの中身の高さ＋伸びる中身の最小より小さくしない
  //（中身が下の境目・ブロックに隠れない）。ほかの中身の高さは、凡例の行の数・欄の幅で変わるので、変わるたびに測り直す
  function fitMins() {
    for (const b of Object.values(blocks)) {
      // data-min-to="選び方": その物の下端までは、ブロックの中を送らずに見える（仕分けの「＋ グループを作る」）
      const to = b.dataset.minTo && b.querySelector(b.dataset.minTo);
      if (to && !b.hidden && !L.fold[b.dataset.blk]) {
        const bb = b.querySelector(".bb"), r = to.getBoundingClientRect(), top = bb.getBoundingClientRect().top;
        if (r.height) b.style.minHeight = `${Math.ceil(b.querySelector(".bh").offsetHeight + r.bottom - top + bb.scrollTop + 8)}px`;
        continue;
      }
      if (to) { b.style.minHeight = ""; continue; }
      const grow = b.querySelector("[data-grow]");
      if (!grow || b.hidden || L.fold[b.dataset.blk]) { b.style.minHeight = ""; continue; }
      const bb = b.querySelector(".bb"), cs = getComputedStyle(bb);
      // 伸びる中身の最小は中の高さ（枠線の分を足す）
      let h = b.querySelector(".bh").offsetHeight + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + (+grow.dataset.grow || 0) + (grow.offsetHeight - grow.clientHeight);
      for (const k of bb.children) {
        if (k.hidden || getComputedStyle(k).display === "none") continue;
        const m = getComputedStyle(k);
        h += parseFloat(m.marginTop) + parseFloat(m.marginBottom) + (k === grow ? 0 : k.offsetHeight);
      }
      b.style.minHeight = `${Math.ceil(h) + 2}px`;   // offsetHeight は整数に丸めた値なので、足した分のずれ（1px ほど）を見込む
    }
  }
  { let raf = 0; const again = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fitMins); };
    const ro = new ResizeObserver(again);
    for (const b of Object.values(blocks)) if (b.querySelector("[data-grow]")) for (const k of b.querySelector(".bb").children) if (!k.dataset.grow) ro.observe(k);
    // 中身が描き直される（仕分けのグループが増える）と測り直す
    for (const b of Object.values(blocks)) if (b.dataset.minTo) new MutationObserver(again).observe(b.querySelector(".bb"), { childList: true, subtree: true }); }
  // 中央（画像一覧）に最小の幅を残す: 出ている欄の幅（覚えた幅か標準）の和が入りきらなければ、欄を比率で細くする（覚えた幅は変えない）
  const DEF_W = { treePane: 340, col2: 300, infoPane: 360 }, MIN_W = { treePane: 180, col2: 180, infoPane: 300 };   // 右は MAP の操作が 1 行に入る幅
  function roomForCenter() {
    const docks = COLS.map((c) => COL_EL[c]).filter((id) => !$(id).hidden);
    const want = Object.fromEntries(docks.map((id) => [id, +(localStorage.getItem(`w_${id}`) || 0) || DEF_W[id]]));
    const room = innerWidth - Math.max(420, innerWidth * 0.38) - docks.length * 5;
    const sum = docks.reduce((a, id) => a + want[id], 0);
    const k = sum > room ? room / sum : 1;
    for (const id of docks) $(id).style.width = `${Math.max(MIN_W[id], Math.round(want[id] * k))}px`;
  }
  window.addEventListener("resize", () => roomForCenter());
  document.addEventListener("DOMContentLoaded", () => roomForCenter());   // app.js が覚えた幅を当てた後にも確かめる
  const apply = () => { save(); render(); };
  // ロット表と画像を見るの切り替え（body.mode-list）で、出すブロックと欄を描き直す
  let wasList = null;
  new MutationObserver(() => { const now = document.body.classList.contains("mode-list"); if (now !== wasList) { wasList = now; render(); } })
    .observe(document.body, { attributes: true, attributeFilter: ["class"] });

  // ---------------------------------------------------------------- 操作: たたむ・境目・移す
  function toggleFold(id) { remember(); if (L.auto[id]) untell(); L.fold[id] = !L.fold[id]; delete L.auto[id]; apply(); }   // 手でたたむ・開いた物は自動の印を外す
  function moveTo(id, col, index) {
    remember();
    const from = where(id);
    for (const c of COLS) L.place[c] = L.place[c].filter((x) => x !== id);
    const arr = L.place[col];
    arr.splice(index == null ? arr.length : Math.max(0, Math.min(arr.length, index)), 0, id);
    if (!shown(col)) L.mode = col === "col2" ? "llcr" : "lcr";   // 隠れている欄へ移すときは、その欄を出す
    delete L.fold[id];
    // 元の欄で、場所が足りずに自動でたたんだブロックは、場所が空いたので開き直す（入りきらなければ makeRoom がまたたたむ）
    if (from !== col) for (const x of Object.keys(L.auto)) if (where(x) === from) { delete L.fold[x]; delete L.auto[x]; untell(); }
    apply();
    if (from !== col) makeRoom(from);
    makeRoom(col, id);
  }
  // 欄にブロックが入りきらない（最小の高さの和が欄より高い）ときは、keep 以外のブロックを、重さの低い順にたたむ。
  // たたんだことは下の帯に出す（勝手に消えたと思わせない）
  const FOLD_ORDER = ["lot", "img", "map", "tree", "cls"];
  function makeRoom(col, keep) {
    const el = $(COL_EL[col]), done = [];
    for (const id of FOLD_ORDER) {
      if (el.hidden || el.scrollHeight <= el.clientHeight + 1) break;
      if (id === keep || !L.place[col].includes(id) || L.fold[id] || blocks[id].hidden) continue;
      L.fold[id] = true; L.auto[id] = true; done.push(blocks[id].dataset.title); render();
    }
    if (!done.length) return;
    save();
    tell(`入りきらないため ${done.join("・")} をたたみました（名前を押すと開く）`);
  }
  // 下の帯の知らせ: 出す前の字を控え、開き直したとき・8 秒たったときに戻す（今と違う知らせを残さない）
  let told = null;
  function tell(text) {
    const st = $("status");
    if (!st) return;
    if (!told) told = { before: st.textContent, cls: st.className };
    st.textContent = text; st.className = "";
    clearTimeout(told.timer);
    told.timer = setTimeout(untell, 8000);
    told.text = text;
  }
  function untell() {
    const st = $("status");
    if (!told || !st) return;
    clearTimeout(told.timer);
    if (st.textContent === told.text) { st.textContent = told.before; st.className = told.cls; }   // ほかの知らせに替わっていたら触らない
    told = null;
  }

  // 境目: 上下の 2 つのブロックの比率を、動かした分だけ移す（高さの和は変えない）
  document.addEventListener("pointerdown", (e) => {
    const sp = e.target.closest(".hsplit");
    if (!sp || sp.classList.contains("off")) return;
    const a = blocks[sp.dataset.a], b = blocks[sp.dataset.b];
    if (L.fold[sp.dataset.a] || L.fold[sp.dataset.b]) return;   // たたんだ側は動かさない
    e.preventDefault(); sp.setPointerCapture(e.pointerId); sp.classList.add("on");
    const y0 = e.clientY, ha = a.offsetHeight, hb = b.offsetHeight, sum = (L.w[sp.dataset.a] || 1) + (L.w[sp.dataset.b] || 1);
    const MIN = 64;
    remember();
    const mv = (ev) => {
      const na = Math.max(MIN, Math.min(ha + hb - MIN, ha + ev.clientY - y0));
      L.w[sp.dataset.a] = (sum * na) / (ha + hb); L.w[sp.dataset.b] = sum - L.w[sp.dataset.a];
      a.style.setProperty("--w", L.w[sp.dataset.a]); b.style.setProperty("--w", L.w[sp.dataset.b]);
    };
    const up = () => { sp.classList.remove("on"); sp.removeEventListener("pointermove", mv); save(); window.dispatchEvent(new Event("dt:layout")); };
    sp.addEventListener("pointermove", mv); sp.addEventListener("pointerup", up, { once: true });
  });
  document.addEventListener("dblclick", (e) => {
    const sp = e.target.closest(".hsplit");
    if (!sp) return;
    remember(); L.w[sp.dataset.a] = WEIGHT[sp.dataset.a]; L.w[sp.dataset.b] = WEIGHT[sp.dataset.b]; apply();
  });

  // ⠿ でつかんで移す: 指の下の欄と、ブロックの上半分・下半分で入れる所を決め、「ここへ移す」の線を出す
  let drag = null;
  document.addEventListener("pointerdown", (e) => {
    const g = e.target.closest(".blk>.bh>.grip");
    if (!g || e.button !== 0) return;
    e.preventDefault();
    const blk = g.closest(".blk");
    drag = { id: blk.dataset.blk, x0: e.clientX, y0: e.clientY, on: false, ghost: null, line: null, to: null };
    g.setPointerCapture(e.pointerId);
  });
  document.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (!drag.on) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
      drag.on = true;
      document.body.classList.add("lay-dragging");
      blocks[drag.id].classList.add("lifted");
      drag.ghost = document.createElement("div");
      drag.ghost.className = "lay-ghost";
      drag.ghost.textContent = `⠿ ${blocks[drag.id].dataset.title}`;
      drag.line = document.createElement("div");
      drag.line.className = "drop-line";
      drag.line.innerHTML = "<span>ここへ移す</span>";
      document.body.append(drag.ghost);
      // 隠れている 2 列目へも落とせるように、ドラッグの間だけ受け皿を出す
      if (!shown("col2")) $("col2").classList.add("lay-spare");
    }
    drag.ghost.style.left = `${e.clientX + 14}px`; drag.ghost.style.top = `${e.clientY + 10}px`;
    drag.to = target(e.clientX, e.clientY);
    if (!drag.to) { drag.line.remove(); return; }
    const col = $(COL_EL[drag.to.col]), ids = L.place[drag.to.col].filter((x) => x !== drag.id && !blocks[x].hidden);
    const before = ids[drag.to.index];
    if (before) blocks[before].before(drag.line); else col.append(drag.line);
  });
  function target(x, y) {
    for (const c of COLS) {
      const col = $(COL_EL[c]);
      if (col.hidden && !col.classList.contains("lay-spare")) continue;
      const r = col.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      const ids = L.place[c].filter((id) => id !== drag.id && !blocks[id].hidden);
      let index = ids.length;
      for (let i = 0; i < ids.length; i++) { const br = blocks[ids[i]].getBoundingClientRect(); if (y < br.top + br.height / 2) { index = i; break; } }
      return { col: c, index };
    }
    return null;
  }
  function endDrag(commit) {
    if (!drag) return;
    const d = drag; drag = null;
    document.body.classList.remove("lay-dragging");
    blocks[d.id].classList.remove("lifted");
    $("col2").classList.remove("lay-spare");
    d.ghost?.remove(); d.line?.remove();
    if (commit && d.on && d.to) {
      moveTo(d.id, d.to.col, d.to.index);
    }
  }
  document.addEventListener("pointerup", () => endDrag(true));
  document.addEventListener("pointercancel", () => endDrag(false));

  // ---------------------------------------------------------------- メニュー（ブロックの ⋯・画面の配置）
  let menu = null;
  const closeMenu = () => { if (menu) { menu.remove(); menu = null; $("layBtn").setAttribute("aria-expanded", "false"); } };
  function openMenu(html, anchor, right) {
    closeMenu();
    menu = document.createElement("div");
    menu.className = right ? "lay-menu" : "blk-menu";
    menu.setAttribute("role", "menu");
    menu.innerHTML = html;
    document.body.append(menu);
    const r = anchor.getBoundingClientRect(), mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = `${Math.max(8, Math.min(innerWidth - mw - 8, r.right - mw))}px`;
    menu.style.top = `${Math.max(8, Math.min(innerHeight - mh - 8, r.bottom + 4))}px`;
    menu.querySelector("button")?.focus();
  }
  function blockMenu(id, anchor) {
    const here = where(id), opts = [];
    for (const c of COLS) {
      if (c === here) continue;
      if (shown(c)) opts.push(`<button type="button" role="menuitem" data-mv="${c}">${COL_NAME[c]}へ</button>`);
      else if (c === "col2") opts.push(`<button type="button" role="menuitem" data-mv="col2">2 列目を足して移す</button>`);
      else opts.push(`<button type="button" role="menuitem" data-mv="${c}">${COL_NAME[c]}を出して移す</button>`);
    }
    const ids = L.place[here], i = ids.indexOf(id);
    if (i > 0) opts.push(`<button type="button" role="menuitem" data-up>上へ</button>`);
    if (i < ids.length - 1) opts.push(`<button type="button" role="menuitem" data-down>下へ</button>`);
    openMenu(`<h5>${blocks[id].dataset.title}を移す先</h5>${opts.join("")}<hr>
      <button type="button" role="menuitem" data-fold>${L.fold[id] ? "開く" : "たたむ"}</button>
      <button type="button" role="menuitem" data-reset-h ${L.w[id] === WEIGHT[id] ? "disabled" : ""}>高さを戻す</button>`, anchor);
    menu.dataset.id = id;
  }
  const icon = (l) => `<span class="lay-ic" aria-hidden="true">${l.map((w) => (w ? `<i style="flex:0 0 ${w}px"></i>` : '<i class="c"></i>')).join("")}</span>`;
  function layoutMenu() {
    const narrow = innerWidth < 1400;
    openMenu(`<h5>欄の数</h5><div class="lay-opts">${Object.entries(MODES).map(([k, m]) => `<button type="button" role="menuitemradio" aria-checked="${L.mode === k}" class="lay-opt${L.mode === k ? " on" : ""}" data-mode-set="${k}">${icon(m.ic)}${m.name}</button>`).join("")}</div>
      ${narrow ? '<div class="lay-hint warn">この窓の幅では「左2列」にすると中央の画像一覧が狭くなります</div>' : ""}
      <h5>よく使う形</h5><div class="lay-opts">${Object.entries(PRESETS).map(([k, p]) => `<button type="button" role="menuitem" class="lay-opt" data-preset="${k}">${p.name}</button>`).join("")}
      <button type="button" role="menuitem" class="lay-opt" data-undo ${prev ? "" : "disabled"} title="1 つ前の配置に戻す">元に戻す</button></div>
      <div class="lay-hint">ブロックは見出しの ⠿ をつかんで欄の間・上下へ移す。境目をドラッグで高さ・見出しの名前を押すとたたむ。配置はこの PC に残ります</div>`, $("layBtn"), true);
    $("layBtn").setAttribute("aria-expanded", "true");
  }
  function setWidths(w) {
    if (!w) return;
    for (const [id, px] of Object.entries(w)) { if (!px) continue; $(id).style.width = `${px}px`; try { localStorage.setItem(`w_${id}`, px); } catch (_) { /* 同上 */ } }
  }

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest("#layBtn")) { if (menu?.classList.contains("lay-menu")) closeMenu(); else layoutMenu(); return; }
    const more = t.closest(".blk>.bh>.bmore");
    if (more) { const id = more.closest(".blk").dataset.blk; if (menu?.dataset.id === id) closeMenu(); else blockMenu(id, more); return; }
    const bt = t.closest(".blk>.bh>.bt");
    if (bt) { toggleFold(bt.closest(".blk").dataset.blk); return; }
    if (!menu || !t.closest(".lay-menu,.blk-menu")) { closeMenu(); return; }
    const id = menu.dataset.id;
    const b = t.closest("button");
    if (!b || b.disabled) return;
    if (b.dataset.mv) moveTo(id, b.dataset.mv);
    else if ("up" in b.dataset || "down" in b.dataset) { const c = where(id), i = L.place[c].indexOf(id); moveTo(id, c, "up" in b.dataset ? i - 1 : i + 1); }
    else if ("fold" in b.dataset) toggleFold(id);
    else if ("resetH" in b.dataset) { remember(); L.w[id] = WEIGHT[id]; apply(); }
    else if (b.dataset.modeSet) { remember(); L.mode = b.dataset.modeSet; apply(); }
    else if (b.dataset.preset) { remember(); const p = PRESETS[b.dataset.preset].make(); setWidths(p.widths); L = p; apply(); }
    else if ("undo" in b.dataset && prev) { const p = prev; prev = null; setWidths(p.widths); L = p; apply(); }
    closeMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && (menu || drag)) { e.stopPropagation(); closeMenu(); endDrag(false); }
  }, true);
  window.addEventListener("resize", closeMenu);

  render();
  // 覚える物（欄の数・置き場・高さの比率・たたみ）だけを返す（「元に戻す」の控えの幅などは含めない）
  window.dtLayout = { get: () => JSON.parse(JSON.stringify({ mode: L.mode, place: L.place, w: L.w, fold: L.fold, auto: L.auto })), reset: () => { remember(); L = STD(); apply(); } };
})();
