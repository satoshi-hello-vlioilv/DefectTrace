// DefectTrace frontend v3.8
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const q = (o) => new URLSearchParams(o).toString();
  // 名前の数の順（localeCompare に毎回 options を渡すと、比べるたびに照合器を作り直して 100 倍遅い。1 つを使い回す）
  const natcmp = new Intl.Collator(undefined, { numeric: true }).compare;
  const PLACE = { list: "ロット一覧", summary: "サマリ", lot: "ロット情報", card: "画像表示（各画像の下）", image: "画像情報", mapx: "MAP 横軸", mapy: "MAP 縦軸" };
  const NEED = { list: "lot", summary: "lot", lot: "lot", card: "image", image: "any", mapx: "image", mapy: "image" };

  const S = { lot: null, gen: 0, group: null, items: [], cur: -1, seen: new Set(), poll: null, zoom: "fit",
    pins: [], LOT: null, img: null, mapSide: "all", sides: {}, kinds: {}, imap: {}, card: [], map: null,
    view: "grid", ms: +(localStorage.getItem("mapMark") || 11), PT: null, ptsel: null, P: null, D: new Map(), psel: null, pselRef: null, pairN: {}, plist: [], plistPairs: [], pshow: 150 };

  const status = (m, err) => { $("status").textContent = m; $("status").className = err ? "err" : ""; };
  async function api(url, opt) {
    const r = await fetch(url, opt);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.status + " " + r.statusText);
    return j;
  }
  const send = (url, body, method = "POST") => api(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  // ================================================================ splitters
  document.querySelectorAll(".split").forEach((sp) => {
    const pane = $(sp.dataset.split), rev = !!sp.dataset.rev;
    const saved = localStorage.getItem("w_" + pane.id); if (saved) pane.style.width = saved + "px";
    sp.addEventListener("pointerdown", (e) => {
      e.preventDefault(); sp.classList.add("on"); sp.setPointerCapture(e.pointerId);
      const x0 = e.clientX, w0 = pane.offsetWidth;
      const mv = (ev) => { pane.style.width = Math.max(180, Math.min(window.innerWidth * 0.6, w0 + (rev ? x0 - ev.clientX : ev.clientX - x0))) + "px"; };
      const up = () => { sp.classList.remove("on"); sp.removeEventListener("pointermove", mv); localStorage.setItem("w_" + pane.id, pane.offsetWidth); drawMap(); };
      sp.addEventListener("pointermove", mv); sp.addEventListener("pointerup", up, { once: true });
    });
  });

  // ================================================================ tree
  const WD = ["日", "月", "火", "水", "木", "金", "土"];
  function dirLabel(name) {
    let m = name.match(/^(\d{4})_(\d{2})_(\d{2})$/);
    if (m) { const d = new Date(+m[1], m[2] - 1, +m[3]); return `${m[2]}/${m[3]} (${WD[d.getDay()]})`; }
    m = name.match(/^(\d{4})_(\d{2})$/);
    return m ? `${m[1]}/${m[2]}` : name;
  }
  async function loadEquipments() {
    const eqs = await api("/api/equipments");
    $("tree").innerHTML = "";
    for (const e of eqs) $("tree").appendChild(dirNode({ name: e.name, path: e.path }, true, e.name));
    restoreLast();
  }
  function dirNode(d, isEq, eq) {
    const li = document.createElement("li");
    li.dataset.path = d.path; li.dataset.eq = eq;
    li.innerHTML = `<div class="row${isEq ? " eq" : ""}" title="${esc(d.path)}"><span class="tw">▶</span><span class="nm">${esc(isEq ? d.name : dirLabel(d.name))}</span><span class="cnt"></span></div><ul hidden></ul>`;
    li.firstChild.addEventListener("click", () => { toggle(li); S.folder = li; if (S.view === "list") window.DTLotList.setScope(listScope()); });
    return li;
  }
  async function toggle(li, open) {
    const ul = li.querySelector(":scope>ul"), tw = li.querySelector(":scope>.row .tw");
    const want = open ?? ul.hidden;
    if (!want) { ul.hidden = true; tw.textContent = "▶"; return; }
    if (!li.dataset.loaded) {
      tw.textContent = "…";
      try {
        const ch = await api("/api/children?" + q({ path: li.dataset.path }));
        ul.innerHTML = "";
        const lots = [];
        for (const c of ch) {
          if (c.kind === "lot") { ul.appendChild(lotNode(c, li.dataset.eq)); lots.push(c.path); }
          else ul.appendChild(dirNode(c, false, li.dataset.eq));
        }
        if (!ch.length) ul.innerHTML = '<li class="hint" style="padding-left:22px">（空）</li>';
        li.querySelector(":scope>.row .cnt").textContent = lots.length ? `${lots.length}ロット` : "";
        li.dataset.loaded = "1";
        if (lots.length) fillLotSummaries(lots);
      } catch (e) { tw.textContent = "▶"; status(e.message, true); return; }
    }
    ul.hidden = false; tw.textContent = "▼";
  }
  // ロット一覧の範囲: 木で最後に押した節（設備・年・月・日）。押していなければ、開いているロットの日。
  // 設備から押した節までの道（crumbs）も渡す（一覧の範囲の表示で、押すと広げられる）
  function listScope() {
    let li = S.folder && S.folder.isConnected ? S.folder : document.querySelector(".lot.sel")?.parentElement?.closest("li");
    if (!li) li = $("tree").querySelector(":scope>li");
    if (!li) return null;
    const crumbs = [];
    for (let x = li; x && x.dataset && x.dataset.path; x = x.parentElement.closest("li")) {
      const isEq = x.parentElement === $("tree");
      crumbs.unshift({ path: x.dataset.path, label: isEq ? x.dataset.eq : x.querySelector(":scope>.row .nm").textContent });
    }
    return { path: li.dataset.path, eq: li.dataset.eq, crumbs };
  }
  // 一覧の行（ロット）を開く: 木にまだ無いロットも開けるよう、木と同じ形の節を作って渡す
  function openLotPath(path) {
    const name = path.split(/[\\/]/).pop();
    const li = document.querySelector(`.lot[data-path="${CSS.escape(path)}"]`) || lotNode({ name, path }, S.folder?.dataset.eq || "");
    setView("grid"); openLot(li);
  }
  window.dtStatus = (m, err) => status(m, err);

  function lotNode(c, eq) {
    const li = document.createElement("li");
    li.className = "lot"; li.dataset.path = c.path; li.dataset.name = c.name; li.dataset.eq = eq;
    li.innerHTML = `<span class="ln">…</span><span class="t">${esc(c.name.slice(11, 16).replace(/_/g, ":"))}</span>`;
    li.title = c.path;
    li.addEventListener("click", () => openLot(li));
    return li;
  }
  async function fillLotSummaries(paths) {
    for (let i = 0; i < paths.length; i += 30) {
      let res;
      try { res = await send("/api/lotsum", { paths: paths.slice(i, i + 30) }); } catch (e) { continue; }
      for (const [p, s] of Object.entries(res)) {
        const li = document.querySelector(`.lot[data-path="${CSS.escape(p)}"]`); if (!li) continue;
        li.innerHTML = s.items.length
          ? s.items.map((x, i) => `<span class="${i === 0 ? "ln" : x.file === "@lot" ? "t" : "v"}">${esc(x.value || (i === 0 ? "—" : ""))}</span>`).join("")
          : `<span class="ln">${esc(s.time)}</span>`;
        li.insertAdjacentHTML("beforeend", flagHtml(s.flags));
        const f = s.flags || {};
        li.dataset.ovl = f.overload > 0 ? f.overload : "";
        li.dataset.search = (s.time + " " + s.items.map((x) => x.value).join(" ") + (f.overload > 0 ? " 多量" : "") + (f.time_warn ? " 時刻" : "")).toLowerCase();
        li.title = `${s.date} ${s.time}\n` + s.items.map((x) => `${x.label || "値"}: ${x.value}`).join("\n") + "\n" + flagText(f) + p;
      }
      applyFilter();
    }
    markDayOverload(paths);
  }
  function flagHtml(f) {
    if (!f) return "";
    let h = "";
    const nm = (f.overload_names || [])[0] || "多量";
    if (f.overload > 0) h += `<span class="fl ovl" title="${esc(nm)} ${f.overload}件：検査計の処理落ち（画像未保存など）の可能性">${esc(nm)} ${f.overload}</span>`;
    else if (f.overload_defined && f.overload === 0) h += `<span class="fl ovl0" title="${esc(nm)} 0件">✓</span>`;
    if (f.detect_max_status > 0) h += `<span class="fl ovl" title="${f.detect_max_status === 2 ? "HDD容量オーバー" : "欠陥最大数オーバー"}（INSP_INFO.detect_max_status=${f.detect_max_status}）：以降の欠陥が記録されていない可能性">${f.detect_max_status === 2 ? "HDD" : "上限"}</span>`;
    if (f.time_warn) h += `<span class="fl twarn" title="フォルダ名の時刻と検査開始/終了時刻が一致しません（差 ${f.time_max_diff ?? "?"} 分）">⏱</span>`;
    return h;
  }
  function flagText(f) {
    if (!f) return "";
    let t = f.overload_defined ? `多量: ${f.overload ?? "不明"}件\n` : "多量: 判定データなし\n";
    if (f.detect_max_status > 0) t += `欠陥数上限: ${f.detect_max_status === 2 ? "HDD容量オーバー" : "最大数オーバー"}\n`;
    if (f.time_warn) t += `時刻の不一致: 差 ${f.time_max_diff} 分\n`;
    return t;
  }
  function markDayOverload(paths) {
    const parents = new Set(paths.map((p) => document.querySelector(`.lot[data-path="${CSS.escape(p)}"]`)?.parentElement).filter(Boolean));
    for (const ul of parents) {
      const cnt = ul.parentElement?.querySelector(":scope>.row .cnt"); if (!cnt) continue;
      const lots = [...ul.querySelectorAll(":scope>.lot")], n = lots.filter((x) => x.dataset.ovl).length;
      cnt.innerHTML = `${lots.length}ロット${n ? ` <span class="fl ovl" title="多量ありのロット数">多量${n}</span>` : ""}`;
    }
  }
  function refreshSummaries() {
    const ps = [...document.querySelectorAll(".lot")].map((x) => x.dataset.path);
    if (ps.length) fillLotSummaries(ps);
  }
  function applyFilter() {
    const f = $("treeFilter").value.trim().toLowerCase();
    document.querySelectorAll(".lot").forEach((li) => {
      const s = li.dataset.search || li.dataset.name.slice(11).replace(/_/g, ":");
      li.hidden = !!f && !s.includes(f) && !li.dataset.name.includes(f);
    });
  }
  async function restoreLast() {
    const last = localStorage.getItem("lastLot"); if (!last) return;
    const low = last.toLowerCase();
    let cur = [...$("tree").children].find((li) => low.startsWith(li.dataset.path.toLowerCase()));
    for (let g = 0; cur && g < 8; g++) {
      await toggle(cur, true);
      const kids = [...cur.querySelector(":scope>ul").children];
      const lot = kids.find((k) => k.classList.contains("lot") && k.dataset.path === last);
      if (lot) { openLot(lot); lot.scrollIntoView({ block: "center" }); return; }
      cur = kids.find((k) => k.dataset.path && /[\\/]/.test(low.charAt(k.dataset.path.length)) && low.startsWith(k.dataset.path.toLowerCase()));
    }
  }

  // ================================================================ lot open
  async function openLot(li) {
    clearInterval(S.poll);
    S.lot = { path: li.dataset.path, name: li.dataset.name, eq: li.dataset.eq };
    Object.assign(S, { items: [], cur: -1, group: null, seen: new Set(), named: false, queue: [], LOT: null, img: null, imap: {}, map: null, sides: {}, kinds: {},
      P: null, D: new Map(), psel: null, pselRef: null, pairN: {}, plist: [], plistPairs: [], pshow: 150, PT: null, ptsel: null });
    S.gen++;
    Object.assign(S, { t0: performance.now(), samples: [], drawn: 0, total: 0, st: null, cardVer: (S.cardVer || 0) + 1,
      phase: { info: "run", link: "wait", map: "wait", pairs: "wait", pitch: "wait" } });
    $("pitchList").innerHTML = '<div class="empty">読込中...</div>'; $("ptSum").textContent = ""; $("pitchCnt").textContent = "";
    const gen = S.gen;
    localStorage.setItem("lastLot", S.lot.path);
    document.querySelectorAll(".lot.sel").forEach((x) => x.classList.remove("sel"));
    li.classList.add("sel");
    const n = S.lot.name;
    $("crumb").innerHTML = `${esc(S.lot.eq)} › ${esc(n.slice(0, 10).replace(/_/g, "/"))} › <b>${esc(n.slice(11).replace(/_/g, ":"))}</b>`;
    cardIO.disconnect(); seenCards.clear();   // 前のロットの枠を見張らない
    $("grid").innerHTML = "";   // 読み込みの進みは帯（#loadBand）が出す
    $("groupTabs").innerHTML = ""; $("groupTabs").dataset.g = "";
    $("imgInfo").innerHTML = '<div class="hint">画像をクリックで表示</div>'; $("imgTitle").textContent = "";
    $("lotInfo").innerHTML = '<div class="hint">読込中...</div>';
    SRC.pick = null; renderSources();
    $("pairList").innerHTML = '<div class="empty">読込中...</div>'; $("pSum").textContent = ""; $("pairCnt").textContent = "";
    drawMap();
    status("ロットを開いています...");
    try { await send("/api/open", { lot: S.lot.path }); } catch (e) { status(e.message, true); return; }
    loadLotInfo(gen);
    await poll(gen);
    S.poll = setInterval(() => poll(gen), 400);
  }

  async function poll(gen) {
    if (gen !== S.gen) return;
    let st;
    // 名前を全部受け取ったら、後は数だけを問う（2 万枚で 1 回 250KB → 数 KB）
    try { st = await api("/api/status?" + q({ lot: S.lot.path, ...(S.named ? { brief: 1 } : {}) })); } catch (e) { status(e.message, true); clearInterval(S.poll); return; }
    if (gen !== S.gen) return;
    const groups = [...new Set(st.cabs.map((c) => c.group))];
    if (!S.group) S.group = groups.length ? groups[0] : "img";   // no image folder : defect data only
    renderTabs(groups);
    renderGrid(st);
    if (st.named) S.named = true;   // この答え（名前つき）で全部の名前を受け取った
    S.st = st;
    S.samples.push([performance.now(), st.thumbs]);
    loadProgress();
    if (!st.total) $("grid").innerHTML = '<div class="empty">このロットには画像がありません（img フォルダに CAB・画像フォルダ・画像ファイルなし）</div>';
    if (st.named && S.mapGen !== gen) { S.mapGen = gen; loadImgMap(gen); }
    if (st.finished) clearInterval(S.poll);
    finishIfDone();
  }
  // 済んだら下の帯に結果を出す（縮小画像・カード・対応付けの全部が済んでから）
  function finishIfDone() {
    const st = S.st;
    if (!st || !st.finished || S.queue.length || S.phase.link !== "done" || S.finishedGen === S.gen) return;
    if (!loadModel().all) return;
    S.finishedGen = S.gen;
    const ng = st.cabs.filter((c) => c.state === "error").length;
    const kd = st.kinds || {}, kl = [kd.cab ? `CAB ${kd.cab}` : "", kd.dir ? `フォルダ ${kd.dir}` : "", kd.loose ? "直下" : ""].filter(Boolean).join("・");
    status(`${S.items.length} 枚 / ${kl || "画像なし"}${ng ? ` / 失敗 ${ng}` : ""} / ${((performance.now() - S.t0) / 1000).toFixed(1)}秒`, ng > 0);
  }

  function renderTabs(groups) {
    const box = $("groupTabs");
    if (box.dataset.g === groups.join("|")) { box.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.g === S.group)); return; }
    box.dataset.g = groups.join("|"); box.innerHTML = "";
    if (groups.length < 2) return;
    for (const g of groups) {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = g; b.dataset.g = g; b.classList.toggle("on", g === S.group);
      b.title = "画像フォルダ切替";
      b.addEventListener("click", async () => {
        Object.assign(S, { group: g, seen: new Set(), items: [], cur: -1, imap: {}, map: null, queue: [], named: false, drawn: 0 });
        cardIO.disconnect(); seenCards.clear();
        $("grid").innerHTML = ""; await poll(S.gen); loadImgMap(S.gen);
      });
      box.appendChild(b);
    }
  }

  // ================================================================ thumbnails as cards
  // 数万枚でも画面を止めない: 塊（CAB）の順を覚えて 1 塊ずつまとめて差し込み（2 乗にしない）、カードは 1 回 12ms までに分けて並べる
  // （並べる間も進みが動き、操作できる）。並べるのは空の枠だけで、中身（見出し・画像・欠陥）は画面に近づいた枠にだけ描く。
  // 対応付けなどが届いたら版（cardVer）を上げ、見えている枠だけ描き直す（ほかは見えたときに描く）
  const key = (it) => `${it.g}/${it.cab}/${it.name}`;
  const mkey = (it) => `${it.cab}/${it.name}`;
  const BUDGET = 12;
  function insertBlock(rank, its) {
    let lo = 0, hi = S.items.length;   // 後ろの塊（rank が大きい）の最初の位置
    while (lo < hi) { const m = (lo + hi) >> 1; if (S.items[m].rank > rank) hi = m; else lo = m + 1; }
    S.items.splice(lo, 0, ...its);
    if (S.cur >= lo) S.cur += its.length;
  }
  function renderGrid(st) {
    const box = $("grid");
    const empty = box.querySelector(".empty"); if (empty && st.total) empty.remove();
    st.cabs.forEach((c, rank) => {
      if (c.group !== S.group) return;
      const id = "cab_" + c.cab;
      let sec = document.getElementById(id);
      if (!sec) {
        sec = document.createElement("div"); sec.className = "cabsep"; sec.id = id;
        sec.innerHTML = `<span>${esc(unitLabel(c))}</span><span class="st"></span>`;
        box.appendChild(sec);
        const ph = document.createElement("div"); ph.className = "ph"; ph.id = id + "_ph"; ph.textContent = "読込中";
        box.appendChild(ph);
      }
      const n = c.images ? c.images.length : c.n;
      const s = sec.querySelector(".st");
      s.className = "st " + c.state;
      s.textContent = { pending: "読込中", running: "読込中", done: `${n}枚`, error: "失敗" }[c.state];
      if (c.error) s.title = c.error;
      const sk = c.group + "/" + c.cab;
      if (c.state === "done" && c.images && !S.seen.has(sk)) {
        S.seen.add(sk);
        const its = c.images.map((name) => ({ g: c.group, cab: c.cab, name, rank }));
        insertBlock(rank, its);
        S.queue.push({ id, its, at: 0 });
      } else if (c.state !== "done") { const ph = document.getElementById(id + "_ph"); if (ph) ph.textContent = s.textContent; }
    });
    S.total = st.cabs.filter((c) => c.group === S.group).reduce((a, c) => a + (c.images ? c.images.length : c.n || 0), 0);
    drainCards(S.gen);
  }
  // 並べ待ちのカードを、1 回 BUDGET ms まで描いて次の画面の描き替えに譲る
  function drainCards(gen) {
    if (S.draining) return;
    S.draining = true;
    const step = () => {
      if (gen !== S.gen) { S.draining = false; return; }
      const t = performance.now();
      while (S.queue.length && performance.now() - t < BUDGET) {
        const job = S.queue[0], ph = document.getElementById(job.id + "_ph");
        const anchor = job.last || ph || document.getElementById(job.id);
        const part = job.its.slice(job.at, job.at + 1000);
        anchor.insertAdjacentHTML("afterend", part.map((it) => `<div class="th" data-key="${esc(key(it))}"></div>`).join(""));
        job.last = anchor;
        for (let k = 0; k < part.length; k++) { job.last = job.last.nextElementSibling; cardIO.observe(job.last); }
        job.at += part.length;
        S.drawn = (S.drawn || 0) + part.length;
        if (job.at >= job.its.length) { if (ph) ph.remove(); S.queue.shift(); }
      }
      if (S.cur < 0 && S.items.length && document.querySelector("#grid .th")) select(0);
      loadProgress();
      if (S.queue.length) requestAnimationFrame(step);
      else { S.draining = false; finishIfDone(); }
    };
    requestAnimationFrame(step);
  }
  const unitLabel = (c) => (c.kind === "dir" ? `${c.cab}/` : c.kind === "loose" ? "(直下の画像)" : `${c.cab}.cab`);
  const idxOf = (it) => S.items.findIndex((x) => x.cab === it.cab && x.name === it.name && x.g === it.g);
  const thumbSrc = (it) => "/thumb?" + q({ lot: S.lot.path, g: it.g, cab: it.cab, name: it.name });

  const markHtml = (m) => `<span class="mk" style="color:${m.kcolor}" title="${esc(m.kname)}">${esc(m.kmark || "●")}</span>`;
  // カード = 枠（見出し・画像）＋欠陥の中身（cm）。対応付けが届いたら見出しと cm だけを書き替える（画像は読み直さない）
  const seenCards = new Set();
  const cardIO = new IntersectionObserver((es) => {
    for (const e of es) { if (e.isIntersecting) { seenCards.add(e.target); fillCard(e.target); } else seenCards.delete(e.target); }
  }, { root: $("grid"), rootMargin: "800px 0px" });
  function fillCard(th) {
    if (th.dataset.v === String(S.cardVer)) return;
    const it = itemOf(th), m = S.imap[mkey(it)];
    if (!th.firstChild) th.innerHTML = `<fieldset><legend></legend><div class="ph-img"><img loading="lazy" decoding="async" alt="" draggable="false" src="${esc(thumbSrc(it))}"></div></fieldset><div class="cm"></div>`;
    th.querySelector(":scope>fieldset>legend").innerHTML = cardHead(it, m);
    th.querySelector(":scope>.cm").innerHTML = cardMeta(it, m);
    th.style.setProperty("--sc", m ? m.scolor : "#9aa3ad");
    th.title = m ? `${m.sname} / ${m.kname}` : "";
    th.dataset.v = S.cardVer;
  }
  const cardHead = (it, m) => (m && m.no != null ? `欠陥No:${m.no}` : esc(`${it.cab}/${it.name}`));
  function cardMeta(it, m) {
    const meta = m
      ? `<fieldset class="meta"><legend>${esc(m.kname)}${markHtml(m)}</legend>` +
        S.card.map((c, i) => `<div class="rw"><span>${esc(c.label)}</span><b>${esc(m.vals[i] ?? "")}</b></div>`).join("") + `</fieldset>`
      : `<fieldset class="meta"><legend class="sub">${Object.keys(S.imap).length ? "欠陥データなし" : "…"}</legend></fieldset>`;
    const pn = m ? S.pairN[m.d] || 0 : 0;
    const face = m ? `<span style="color:${m.scolor}">■ ${esc(m.sname)}${pn ? ` <span class="tbadge" data-pairs="${m.d}" title="転写候補を表示">転写候補 ${pn}</span>` : ""}</span>` : "<span></span>";
    return `${meta}<div class="nm2">${face}<span>${esc(it.cab)}/${esc(it.name)}</span></div>`;
  }
  // 描いたカードの中身を書き替える（対応付け・転写候補が届いたとき）。いま見えている枠だけ。ほかは見えたときに描く
  function updateCards() {
    S.cardVer = (S.cardVer || 0) + 1;
    $("grid").style.setProperty("--rows", S.card.length);
    for (const th of seenCards) if (th.isConnected) fillCard(th); else seenCards.delete(th);
  }
  $("grid").addEventListener("click", (e) => { const th = e.target.closest(".th"); if (th && !e.target.closest(".tbadge")) select(idxOf(itemOf(th))); });
  $("grid").addEventListener("dblclick", (e) => { const th = e.target.closest(".th"); if (th) { select(idxOf(itemOf(th))); openViewer(); } });
  const itemOf = (th) => { const [g, cab, name] = th.dataset.key.split("/"); return { g, cab, name }; };

  // ================================================================ loading progress
  // 読み込みの段階（何を・どこまで・あとどれくらい・もう使えるか）。数は /api/status と、画面で並べた数から。
  // 見せ方は 3 回の案出しと採点で R4 に決めた（program/tools/proposals/2026-10-26-load-progress*.）: ツールバーの下の 1 つの帯
  // （いまの段階・数・棒・残り時間・操作できます／段階の並び）。使えるようになるまでは大きく、使えると小さく（場所は変えない）。
  // 左下の状態も同じ言葉
  function loadModel() {
    const st = S.st || { total: 0, done: 0, thumbs: 0, thumbs_total: 0 }, ph = S.phase || {};
    const now = performance.now();
    // 縮小画像の速さ: 直近 3 秒の進み（始めは全体の平均）
    const sm = S.samples || [], last = sm[sm.length - 1];
    const old = sm.find((x) => x[0] >= now - 3000) || sm[0];
    const rate = last && old && last[0] > old[0] ? ((last[1] - old[1]) * 1000) / (last[0] - old[0]) : 0;
    const eta = st.finished ? 0 : rate > 0 ? (st.thumbs_total - st.thumbs) / rate : null;
    const an = ["map", "pairs", "pitch"].filter((k) => ph[k] === "done").length;
    const fin = (s) => s === "done" || s === "error";
    const steps = [
      { k: "names", label: "画像の一覧", verb: "を読んでいます", num: `CAB ${fmtN(st.done)} / ${fmtN(st.total)}`, frac: st.total ? st.done / st.total : 0, state: S.named || (st.total && st.done >= st.total) ? "done" : "run" },
      { k: "info", label: "欠陥データ", verb: "を読んでいます", num: "", frac: null, state: ph.info === "done" ? "done" : ph.info === "error" ? "error" : "run" },
      { k: "cards", label: "画像の枠", verb: "を並べています", num: `${fmtN(S.drawn || 0)} / ${fmtN(S.total || 0)}`, frac: S.total ? (S.drawn || 0) / S.total : 0, state: S.named && !S.queue.length ? "done" : S.named ? "run" : "wait" },
      { k: "link", label: "画像と欠陥の対応", verb: "を付けています", num: "", frac: null, state: ph.link === "run" ? "run" : fin(ph.link) ? ph.link : "wait" },
      { k: "analysis", label: "MAP・転写・ピッチ", verb: "を計算しています", num: `${an} / 3`, frac: an / 3, state: an === 3 ? "done" : ph.link === "done" ? "run" : "wait" },
      { k: "thumbs", label: "縮小画像", verb: "を作っています", num: `${fmtN(st.thumbs)} / ${fmtN(st.thumbs_total)}`, frac: st.thumbs_total ? st.thumbs / st.thumbs_total : 1, state: st.finished ? "done" : S.named ? "run" : "wait", eta },
    ];
    // 使える: 一覧・欠陥データ・画像の枠がそろった（縮小画像は見ている所から先に作るので、待たなくてよい）
    const usable = ["names", "info", "cards"].every((k) => fin(steps.find((s) => s.k === k).state));
    const all = steps.every((s) => fin(s.state));
    // いま見せる段階: 走っている物のうち、まだ使えないなら前の方、使えるなら縮小画像（いちばん長い）を先に
    const runs = steps.filter((s) => s.state === "run");
    const cur = (usable && runs.find((s) => s.k === "thumbs")) || runs[0] || null;
    return { steps, rate, eta, usable, all, cur, st };
  }
  let progFrame = 0;
  function loadProgress() {
    if (progFrame) return;
    progFrame = requestAnimationFrame(() => { progFrame = 0; renderLoad(loadModel()); });
  }
  const fmtN = (n) => Number(n || 0).toLocaleString("ja-JP");
  const fmtSec = (s) => (s == null ? "計算中" : s < 1 ? "1 秒未満" : s < 60 ? `約 ${Math.ceil(s)} 秒` : `約 ${Math.floor(s / 60)} 分 ${Math.round(s % 60)} 秒`);
  const ICON = { done: "✓", run: "●", wait: "○", error: "!" };
  function renderLoad(m) {
    if (m.all) finishIfDone();
    const band = $("loadBand"), show = !!S.lot && !m.all && S.phase;
    band.hidden = !show;
    if (!show) return;
    const c = m.cur || m.steps.find((s) => s.state !== "done") || m.steps[5];
    const eta = c.k === "thumbs" ? fmtSec(m.eta) : "計算中";
    const steps = m.steps.map((s) => `<span class="lpst ${s.state}${s.state === "done" ? " lpdn" : s.state === "wait" ? " lpwt" : ""}" title="${esc(s.label)}"><i>${ICON[s.state]}</i>${esc(s.label)}</span>`).join("");
    const nd = m.steps.filter((s) => s.state === "done").length, waits = m.steps.filter((s) => s.state === "wait");
    band.classList.toggle("big", !m.usable);
    band.innerHTML = `<div class="r1"><span class="now">${esc(c.label)}<em>${esc(c.verb)}</em></span><span class="num">${esc(c.num)}</span>
      <div class="lpbar${c.frac == null ? " ind" : ""}"><i style="width:${c.frac == null ? 30 : Math.round(c.frac * 100)}%"></i></div><span class="sub">あと</span><span class="lpeta">${esc(eta)}</span>${m.usable ? '<span class="use">✓ 操作できます</span>' : ""}</div>
      <div class="r2">${nd ? `<span class="lpst done lpsum" title="済んだ段階"><i>✓</i>済み ${nd} / 6</span>` : ""}${steps}${waits.length ? `<span class="lpst wait lpwsum" title="${esc(waits.map((s) => s.label).join("・"))}"><i>○</i>残り ${waits.length} 段階</span>` : ""}</div>
      ${m.usable ? "" : '<div class="r3 sub" title="縮小画像は、見ている所から先に作ります">画像の一覧と欠陥データがそろうと、操作できるようになります</div>'}`;
    if (!S.finishedGen || S.finishedGen !== S.gen) status(`${c.label}${c.verb}${c.num ? " " + c.num : ""} ・ あと ${eta}`);
  }

  // ================================================================ detect data
  async function loadImgMap(gen) {
    if (!S.lot || !S.group) return;
    let d;
    if (S.phase.link !== "done") { S.phase.link = "run"; loadProgress(); }
    try { d = await api("/api/imgmap?" + q({ lot: S.lot.path, g: S.group })); } catch (e) { if (gen === S.gen) { S.phase.link = "error"; loadProgress(); } return; }
    if (gen !== S.gen) return;
    S.phase.link = "done";
    S.imap = d.map; S.sides = d.sides || {}; S.kinds = d.kinds || {}; S.card = d.card || [];
    updateCards();
    renderMapSide();
    loadMap(gen);
    loadPairs(gen);
    loadPitch(gen);
    if (S.cur >= 0) select(S.cur);
    if (!Object.keys(S.imap).length && d.info) status(`画像と欠陥データの対応付けができません（${JSON.stringify(d.info)}）`, true);
  }
  const sideName = (v) => S.sides[v]?.name ?? (v == null ? "" : `G${v}`);
  const sideColor = (v) => S.sides[v]?.color || "#1e5aa8";
  const kindOf = (v) => S.kinds[String(v)] || { name: `分類${v}`, mark: "●", color: "#333" };
  const isFront = (v) => /表/.test(sideName(v));
  function sideList() {
    const vs = new Set(Object.keys(S.sides).map(Number));
    if (S.map?.ok) S.map.points.forEach((p) => vs.add(p[2]));
    return [...vs].sort((a, b) => (isFront(b) - isFront(a)) || a - b);
  }
  function renderMapSide() {
    const vs = sideList(), box = $("mapSide");
    box.innerHTML = [["all", "両面", null], ...vs.map((v) => [String(v), sideName(v), v])].map(([v, t, sv]) =>
      `<button type="button" data-v="${esc(v)}" class="${String(S.mapSide) === v ? "on" : ""}">${sv != null ? `<span class="dot" style="background:${sideColor(sv)}"></span>` : ""}${esc(t)}</button>`).join("");
  }
  $("mapSide").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    S.mapSide = b.dataset.v; renderMapSide(); drawMap();
  });

  // ================================================================ selection / image info
  let infoTimer = null;
  function select(i) {
    if (i < 0 || i >= S.items.length) return;
    S.cur = i;
    const it = S.items[i];
    document.querySelectorAll(".th.sel").forEach((x) => x.classList.remove("sel"));
    const t = document.querySelector(`.th[data-key="${CSS.escape(key(it))}"]`);
    if (t) { t.classList.add("sel"); if (S.view === "grid") t.scrollIntoView({ block: "nearest" }); }
    $("imgTitle").textContent = `${it.cab}/${it.name}  (${i + 1}/${S.items.length})`;
    drawMap();
    if (!$("viewer").hidden) showViewer();
    clearTimeout(infoTimer);
    infoTimer = setTimeout(() => loadImgInfo(it), 60);
  }
  async function loadImgInfo(it) {
    const gen = S.gen;
    let d;
    try { d = await api("/api/imginfo?" + q({ lot: S.lot.path, g: it.g, cab: it.cab, name: it.name })); }
    catch (e) { $("imgInfo").innerHTML = `<div class="hint err">${esc(e.message)}</div>`; return; }
    if (gen !== S.gen || S.items[S.cur] !== it) return;
    S.img = d;
    renderImgInfo(); renderSources();
  }
  function renderImgInfo() {
    const d = S.img; if (!d) return;
    const it = S.items[S.cur]; if (!it) return;
    let h = "";
    if (d.head) h += `<div class="ihead"><span>欠陥No:${esc(d.head.no)}</span><span>${esc(d.head.kname)}${markHtml(d.head)}</span><span class="tag" style="background:${d.head.scolor}">${esc(d.head.sname)}</span></div>`;
    h += '<table class="kv">';
    h += d.card.map((p) => pinRow(p, "card", true)).join("");
    h += d.pinned.map((p) => pinRow(p, "image")).join("");
    h += lotPins("image").map((p) => pinRow(p, "image")).join("");
    h += kv("画像", `${it.cab}/${it.name}  ${d.width}×${d.height}${d.bits ? " " + d.bits + "bit" : ""}`);
    h += "</table>";
    if (d.detect_index == null) h += `<div class="hint">${d.map_final ? "欠陥データとの対応なし" : "全画像の展開後に欠陥データと対応付けます"}</div>`;
    $("imgInfo").innerHTML = h;
    $("vInfo").innerHTML = h + `<div class="sec">ロット</div><table class="kv">${lotPins("summary").concat(lotPins("lot")).map((p) => pinRow(p, "x")).join("")}</table>`;
  }

  // ================================================================ lot info
  async function loadLotInfo(gen) {
    try {
      const d = await api("/api/info?" + q({ lot: S.lot.path }));
      if (gen !== S.gen) return;
      S.LOT = d; S.phase.info = "done"; loadProgress();
      if (!Object.keys(S.sides).length) S.sides = d.sides || {};
      if (!Object.keys(S.kinds).length) S.kinds = d.kinds || {};
      renderLot(); renderSources(); renderImgInfo(); renderMapSide();
    } catch (e) { if (gen === S.gen) { $("lotInfo").innerHTML = `<div class="hint err">${esc(e.message)}</div>`; S.phase.info = "error"; loadProgress(); } }
  }
  const lotPins = (place) => (S.LOT ? S.LOT.pinned.filter((p) => p.place === place) : []);
  function renderLot() {
    const d = S.LOT;
    $("summary").querySelector(".pins").innerHTML = d ? (lotPins("summary").map((p) => chip(p, "summary", true)).join("") || '<span class="hint">ロット情報の項目をここへドラッグ</span>') : "";
    if (!d) return;
    let h = '<table class="kv">' + kv("設備", S.lot.eq) + kv("作業日時", `${d.date} ${d.time}`);
    h += lotPins("lot").map((p) => pinRow(p, "lot")).join("");
    h += kv("画像", Object.entries(d.cab_groups).map(([k, v]) => `${k}:${v}`).join(" / ") || "なし");
    h += kv("総容量", (d.total_bytes / 1048576).toFixed(1) + " MB") + "</table>";
    const ov = d.overload;
    if (ov) {
      const sidesTxt = Object.entries(ov.sides || {}).map(([g, n]) => `${sideName(+g)} ${n}`).join("・");
      const camTxt = Object.entries(ov.cams || {}).map(([c, n]) => `${c}：${n}`).join("<br>");
      const dms = ov.detect_max_status;
      let rows = "";
      if (ov.defined) {
        rows += `<tr class="${ov.count > 0 ? "ovlrow" : ""}"><td class="k" title="${esc(ov.by || "")}">多量</td><td>${ov.count > 0 ? `<b>${ov.count} 件</b>（処理落ちの可能性）` : "0 件（正常）"}${ov.detect_count != null && ov.detect_count !== ov.count ? ` <span class="sub">DETECT_INFO ${ov.detect_count}件</span>` : ""}</td><td class="b"></td></tr>`;
        if (ov.count > 0) {
          if (sidesTxt) rows += kv("面別", sidesTxt);
          if (ov.detect_total != null) rows += kv("欠陥数の内訳", `合計 ${ov.detect_total} ＝ 通常 ${ov.detect_total - ov.count} ＋ 多量 ${ov.count}（画像 ${ov.image_total ?? "—"} 枚）`);
          if (ov.events) rows += kv("発生位置", `${ov.events} か所（${ov.y_first} 〜 ${ov.y_last} m）`);
          if (camTxt) rows += `<tr><td class="k">カメラ別</td><td>${camTxt}</td><td class="b"></td></tr>`;
        }
      } else rows += kv("多量", "判定データなし（INSP_INFO.error_count なし）");
      rows += `<tr class="${dms > 0 ? "ovlrow" : ""}"><td class="k">欠陥数上限</td><td>${dms > 0 ? `<b>${dms === 2 ? "HDD容量オーバー" : "最大数オーバー"}</b>` : dms === 0 ? "なし（正常）" : "—"}</td><td class="b"></td></tr>`;
      h += `<div class="sec">検査状態チェック</div><table class="kv">${rows}</table>`;
    }
    const tc = d.timecheck;
    if (tc && tc.rows.length) {
      h += `<div class="sec">日時の整合（基準：フォルダ名 ${esc(tc.ref)}）</div><table class="kv tcheck">` +
        tc.rows.map((r) => `<tr class="${r.warn ? "warn" : ""}"><td class="k" title="${esc(r.src)}${r.mode ? "（" + (r.mode === "binary" ? "UTC保存→時差補正" : "現地時刻で保存") + "）" : ""}">${esc(r.label)}</td><td>${esc(r.value || "—")}</td><td class="num">${r.diff_min == null ? "" : (r.diff_min > 0 ? "+" : "") + r.diff_min + "分"}</td></tr>`).join("") + "</table>";
    }
    const cs = d.classes;
    if (cs && cs.rows.length) {
      const sids = Object.keys(cs.sides).sort((a, b) => (/表/.test(cs.sides[b].name) - /表/.test(cs.sides[a].name)) || a - b);
      h += `<div class="sec">分類別集計</div><table class="kv cls"><tr><th>分類</th>${sids.map((g) => `<th style="color:${cs.sides[g].color}">${esc(cs.sides[g].name)}</th>`).join("")}<th>合計</th></tr>` +
        cs.rows.map((r) => `<tr><td><span style="color:${r.color}">${esc(r.mark)}</span> ${esc(r.name)}</td>${sids.map((g) => `<td class="num">${r.sides[g] || 0}</td>`).join("")}<td class="num"><b>${r.total ?? Object.values(r.sides).reduce((a, b) => a + b, 0)}</b></td></tr>`).join("") + "</table>";
    }
    if (d.work) h += '<div class="sec">作業情報</div><table class="kv">' + Object.entries(d.work).map(([k, v]) => kv(k, v)).join("") + "</table>";
    $("lotInfo").innerHTML = h;
  }
  function renderPinZones() {
    for (const el of document.querySelectorAll(".pins[data-place]")) {
      const pl = el.dataset.place;
      if (pl === "summary") continue;
      el.innerHTML = S.pins.filter((p) => p.place === pl).map((p) => chip({ id: p.id, label: p.label || shortKey(p.key), value: "" }, pl, false)).join("") || '<span class="hint">ここへドラッグ</span>';
    }
  }

  // ================================================================ sources (draggable, reorderable)
  const srcKey = (file) => "srcOrder:" + file;
  function saveSrcOrder(tb) {
    const f = tb.querySelector("tr.src")?.dataset.file; if (!f) return;
    localStorage.setItem(srcKey(f), JSON.stringify([...tb.querySelectorAll("tr.src")].map((r) => r.dataset.key)));
  }
  function applySrcOrder(file, rows) {
    let ord; try { ord = JSON.parse(localStorage.getItem(srcKey(file)) || "null"); } catch (e) { ord = null; }
    if (!ord) return rows;
    const pos = new Map(ord.map((k, i) => [k, i]));
    return rows.map((r, i) => [r, pos.has(r[0]) ? pos.get(r[0]) : 1e6 + i]).sort((a, b) => a[1] - b[1]).map((x) => x[0]);
  }
  // ---------------------------------------------------------------- データ項目の窓（3 回の案出しと採点で M に決めた:
  // program/tools/proposals/2026-10-26-data-items*.）左に分類・中に探せる項目・右に表示先（いつも右の 1 か所）。
  // 項目はドラッグで表示先へ（窓の中の表示先にも、窓の外の本物の枠にも置ける）。行を選ぶと、その行に置ける先がボタンで出て、
  // 押して出し入れできる（置き済みは ✓）。名前は置いた表示項目の名前でも探せる
  const SRC = { cat: 0, pick: null };
  // 行の札は短い名前（列の幅に収める。長い名前は表示先の列にある）
  const PLACE_SHORT = { list: "一覧", summary: "サマリ", lot: "ロット情報", card: "画像表示", image: "画像情報", mapx: "MAP 横軸", mapy: "MAP 縦軸" };
  const PLACE_SUB = { list: "左の一覧の各行", summary: "中央上の帯", lot: "右列", card: "各画像の下", image: "右列の上", mapx: "MAP の横", mapy: "MAP の縦" };
  // 表示先の位置の小さな図（画面のどこに出るか）
  const POS = { list: [0, 0, 22, 100], summary: [25, 0, 47, 20], card: [25, 24, 47, 14], image: [75, 0, 25, 30], mapx: [75, 34, 25, 12], mapy: [75, 48, 25, 12], lot: [75, 64, 25, 36] };
  const ico = (pl) => `<span class="pico" aria-hidden="true">${Object.entries(POS).map(([k, [x, y, w, h]]) => `<i style="left:${x}%;top:${y}%;width:${w}%;height:${h}%"${k === pl ? ' class="on"' : ""}></i>`).join("")}</span>`;
  const scopeTag = (s) => `<span class="dsc ${s}">${s === "image" ? "画像ごと" : s === "lot" ? "ロット" : "どちらも"}</span>`;
  const wildKey = (k) => k.replace(/\[\d+\]/g, "[*]");
  // その行（file・key）を出している表示項目（[*] でまとめた物も）
  const pinsOf = (file, key) => S.pins.filter((p) => p.file === file && (p.key === key || p.key === wildKey(key)));
  function srcGroups() {
    const gs = [];
    const add = (src, name, scope, file, items, info = "", order = file) =>
      gs.push({ src, name, scope, file, info, rows: applySrcOrder(order, items).map(([k, v, l]) => {
        const pin = pinsOf(file, k)[0];
        return { key: k, val: v, l: l || "", label: pin?.label || l || shortKey(k) };
      }) });
    if (S.img && S.img.detect.length) add("画像", "DETECT_INFO（選んだ画像）", "image", "dat:DETECT_INFO", S.img.detect);
    if (S.img) for (const x of S.img.xml) add("画像", x.name, "image", "@image", x.items);
    const d = S.LOT;
    if (d) {
      if (d.meta) add("ロット", "フォルダ名（作業日時）", "lot", "@lot", d.meta);
      for (const x of d.dat) add("ロット", x.name + ".dat", "lot", "dat:" + x.name, x.fields, x.error ? x.error : `${x.count}件${x.count > 3 ? "（レコード多数: 画像・MAP で使う）" : ""}`);
      for (const x of d.xml) add("ロット", x.name, "lot", x.glob, x.items);
      gs.push({ src: "ロット", name: "付帯ファイル", scope: null, file: "", info: `${d.files.length} 件`, rows: d.files.map((x) => ({ key: x.name, val: (x.size / 1024).toFixed(1) + " KB", l: "", label: x.name })) });
    }
    return gs;
  }
  function renderSources() {
    if ($("srcModal").hidden) return;
    // 行を押している間・ドラッグ中に描き直すと、つかんでいる行が消えてドラッグが切れる。離してから描く（pointerup・dragend）
    if (DRAG || SRC.hold) { SRC.dirty = true; return; }
    SRC.dirty = false;
    const f = $("srcFilter").value.trim().toLowerCase();
    const hit = (r) => !f || (r.label + " " + r.key + " " + r.val + " " + r.l).toLowerCase().includes(f);
    const gs = srcGroups();
    SRC.cat = Math.min(SRC.cat, Math.max(0, gs.length - 1));
    const total = gs.reduce((a, g) => a + g.rows.length, 0), hits = gs.reduce((a, g) => a + g.rows.filter(hit).length, 0);
    $("srcCount").textContent = f ? `${hits} 件` : `${total} 項目`;
    $("srcCats").innerHTML = gs.map((g, i) => { const n = f ? g.rows.filter(hit).length : g.rows.length;
      return `<button type="button" class="dcat${i === SRC.cat && !f ? " on" : ""}${!n ? " zero" : ""}" data-cat="${i}" title="${esc(g.src + "：" + g.name)}"><span>${esc(g.src)}：${esc(g.name)}</span><span class="n">${n}</span></button>`; }).join("") || '<div class="hint">ロットを選ぶと出ます</div>';
    const hl = (s) => { const t = esc(s); if (!f) return t; const i = t.toLowerCase().indexOf(esc(f).toLowerCase()); return i < 0 ? t : t.slice(0, i) + "<mark>" + t.slice(i, i + esc(f).length) + "</mark>" + t.slice(i + esc(f).length); };
    const show = f ? gs.filter((g) => g.rows.some(hit)) : gs.slice(SRC.cat, SRC.cat + 1);
    $("srcRows").innerHTML = show.map((g) => {
      const rs = g.rows.filter(hit);
      const head = `<div class="dgh">${esc(g.src)}：<b>${esc(g.name)}</b><span class="sub"> ${rs.length} 件${g.info ? " ・ " + esc(g.info) : ""}</span></div>`;
      if (!g.scope) return head + `<table class="dtab">${rs.map((r) => `<tr><td class="dl1">${hl(r.label)}</td><td class="dv">${hl(r.val)}</td><td></td></tr>`).join("")}</table>`;
      if (!rs.length) return head + '<div class="hint">（値の項目なし）</div>';
      return head + `<table class="dtab"><colgroup><col><col style="width:180px"><col style="width:220px"></colgroup>` + rs.map((r) => {
        const placed = [...new Set(pinsOf(g.file, r.key).map((p) => p.place))];
        const tags = placed.slice(0, 2).map((p) => `<span class="dpl" title="${esc(PLACE[p])}">${esc(PLACE_SHORT[p])}</span>`).join("") + (placed.length > 2 ? `<span class="dpl more">+${placed.length - 2}</span>` : "");
        const picked = SRC.pick && SRC.pick.file === g.file && SRC.pick.key === r.key;
        const row = `<tr class="src drow${picked ? " picked" : ""}" draggable="true" data-scope="${g.scope}" data-file="${esc(g.file)}" data-key="${esc(r.key)}" data-val="${esc(r.val)}" data-label="${esc(r.l)}" title="ドラッグで表示先へ／押すと置く先のボタン">
          <td class="dl1"><span class="grip" aria-hidden="true">⠿</span><b>${hl(r.label)}</b><small>${hl(r.key)} ${scopeTag(g.scope)}</small></td>
          <td class="dv" title="${esc(r.val)}">${hl(r.val || "—")}</td><td class="dps">${tags}<span class="dgo">${picked ? "▴" : "置く先 ▾"}</span></td></tr>`;
        if (!picked) return row;
        const btns = Object.keys(PLACE).filter((pl) => ok(g.scope, pl)).map((pl) => { const on = placed.includes(pl);
          return `<button type="button" class="mb${on ? " on" : ""}" data-toggle="${pl}" aria-pressed="${on}" title="${on ? "押すと外す" : "押すと置く"}">${ico(pl)}${esc(PLACE[pl])}${on ? " ✓" : ""}</button>`; }).join("");
        return row + `<tr class="mq"><td colspan="3"><span class="sub">置く先:</span>${btns}<button type="button" class="lnk" data-named="1">名前を付けて置く…</button></td></tr>`;
      }).join("") + "</table>";
    }).join("") || `<div class="hint">${f ? "見つかりません（項目名・キー・値で探します）" : "ロットを選ぶと出ます"}</div>`;
    $("srcPlaces").innerHTML = Object.keys(PLACE).map((pl) => `<div class="dplace dz" data-drop="${pl}"><div class="dph">${ico(pl)}<b>${esc(PLACE_SHORT[pl])}</b><span class="sub">${esc(PLACE_SUB[pl])}</span>${scopeTag(NEED[pl] === "any" ? "any" : NEED[pl])}</div>
      <div class="dchips"><span class="pins" data-place="${pl}">${S.pins.filter((p) => p.place === pl).map((p) => chip({ id: p.id, label: p.label || shortKey(p.key), value: "" }, pl, false)).join("") || '<span class="hint">ここへドラッグ</span>'}</span></div></div>`).join("");
  }
  function openSources() {
    $("srcModal").hidden = false; renderSources();
    $("srcFilter").focus(); $("srcFilter").select();
  }
  const closeSources = () => { $("srcModal").hidden = true; $("pinPop").hidden = true; };
  $("btnSources").addEventListener("click", openSources);
  $("srcClose").addEventListener("click", closeSources);
  $("srcModal").addEventListener("mousedown", (e) => { if (e.target === $("srcModal")) closeSources(); });
  $("srcFilter").addEventListener("input", () => { SRC.pick = null; renderSources(); });
  $("srcCats").addEventListener("click", (e) => { const b = e.target.closest("[data-cat]"); if (!b) return; SRC.cat = +b.dataset.cat; $("srcFilter").value = ""; SRC.pick = null; renderSources(); });
  $("srcRows").addEventListener("pointerdown", (e) => { if (e.target.closest("tr.src")) SRC.hold = true; });
  const release = () => { if (!SRC.hold) return; SRC.hold = false; if (SRC.dirty && !DRAG) renderSources(); };
  document.addEventListener("pointerup", release);
  document.addEventListener("pointercancel", release);
  $("srcRows").addEventListener("click", async (e) => {
    const tg = e.target.closest("[data-toggle]");
    if (tg) {
      e.stopPropagation();
      const tr = tg.closest("tr").previousElementSibling, pl = tg.dataset.toggle;
      const have = pinsOf(tr.dataset.file, tr.dataset.key).filter((p) => p.place === pl);
      try {
        if (have.length) for (const p of have) await api("/api/pins/" + encodeURIComponent(p.id), { method: "DELETE" });
        else await send("/api/pins", { scope: tr.dataset.scope, file: tr.dataset.file, key: tr.dataset.key, label: tr.dataset.label || autoLabel(tr.dataset.key), place: pl });
        await afterPins(); status(have.length ? `「${PLACE[pl]}」から外しました` : `「${PLACE[pl]}」に置きました`);
      } catch (er) { status(er.message, true); }
      return;
    }
    const nm = e.target.closest("[data-named]");
    if (nm) { e.stopPropagation(); openPop(nm.closest("tr").previousElementSibling, nm); return; }
    const tr = e.target.closest("tr.src"); if (!tr) return;
    const same = SRC.pick && SRC.pick.file === tr.dataset.file && SRC.pick.key === tr.dataset.key;
    SRC.pick = same ? null : { file: tr.dataset.file, key: tr.dataset.key };
    renderSources();
  });

  function kv(k, v) { return `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td><td class="b"></td></tr>`; }
  const shortKey = (k) => k.split("/").slice(-2).join("/");
  function pinRow(p, place, num) {
    const movable = place !== "x";
    return `<tr class="pinned"${movable ? ` draggable="true" data-pid="${esc(p.id)}" data-place="${place}"` : ""}><td class="k" title="ドラッグで並べ替え・移動／ダブルクリックで名前変更">${esc(p.label || "（無題）")}</td><td${num ? ' class="num"' : ""}>${esc(p.value || "—")}</td><td class="b">${movable ? `<button type="button" class="pb" data-unpin="${esc(p.id)}" title="表示から外す">×</button>` : ""}</td></tr>`;
  }
  const FMT = { time: [["hhmm", "hh:mm"], ["hhmmss", "hh:mm:ss"]], date: [["mmdd", "mm/dd"], ["yyyymmdd", "yyyy/mm/dd"]] };
  function chip(p, place, withVal) {
    const full = S.pins.find((x) => x.id === p.id);
    let fm = "";
    if (full && full.file === "@lot" && FMT[full.key]) {
      const opts = FMT[full.key], cur = opts.find((o) => o[0] === full.fmt) || opts[0];
      fm = `<button type="button" class="fm" data-fmt="${esc(p.id)}" title="表示書式を切り替え">${esc(cur[1])}</button>`;
    }
    return `<span class="chip" draggable="true" data-pid="${esc(p.id)}" data-place="${place}" title="ドラッグで並べ替え・移動／ダブルクリックで名前変更">${p.label ? `<span class="cl">${esc(p.label)}</span>` : ""}${fm}${withVal ? `<span class="cv">${esc(p.value || "—")}</span>` : ""}<button type="button" class="x" data-unpin="${esc(p.id)}" title="外す">×</button></span>`;
  }

  // ================================================================ drag & drop (set / move / reorder)
  let DRAG = null;
  document.addEventListener("dragstart", (e) => {
    const src = e.target.closest?.("tr.src");
    const pin = e.target.closest?.("[data-pid]");
    if (src) DRAG = { kind: "src", el: src, scope: src.dataset.scope, file: src.dataset.file, key: src.dataset.key, label: src.dataset.label || autoLabel(src.dataset.key) };
    else if (pin) { const p = S.pins.find((x) => x.id === pin.dataset.pid); DRAG = p ? { kind: "pin", id: p.id, scope: p.scope, place: p.place } : null; }
    else return;
    if (!DRAG) return;
    e.dataTransfer.effectAllowed = "copyMove";
    e.dataTransfer.setData("text/plain", DRAG.key || DRAG.id);
    if (ok(DRAG.scope, "list")) requestAnimationFrame(() => document.body.classList.add("dragging"));
    // データ項目の窓の表示先: 置ける所を緑に、置けない所を薄く
    document.querySelectorAll("#srcPlaces .dplace").forEach((z) => { z.classList.toggle("ok", ok(DRAG.scope, z.dataset.drop)); z.classList.toggle("ng", !ok(DRAG.scope, z.dataset.drop)); });
  });
  const clearIns = () => document.querySelectorAll(".ins-before,.ins-after,.ins-l,.ins-r").forEach((x) => x.classList.remove("ins-before", "ins-after", "ins-l", "ins-r"));
  document.addEventListener("dragend", () => { DRAG = null; SRC.hold = false; if (SRC.dirty) renderSources(); clearIns(); document.querySelectorAll("#srcPlaces .dplace").forEach((z) => z.classList.remove("ok", "ng")); document.body.classList.remove("dragging"); document.querySelectorAll(".dz.over").forEach((x) => x.classList.remove("over")); });
  const ok = (scope, place) => NEED[place] === "any" || NEED[place] === scope;
  function insPos(el, e) {
    const r = el.getBoundingClientRect();
    return el.tagName !== "TR" ? (e.clientX > r.left + r.width / 2 ? "after" : "before") : (e.clientY > r.top + r.height / 2 ? "after" : "before");
  }
  function markIns(el, pos) {
    clearIns();
    if (el.tagName === "TR") el.classList.add(pos === "after" ? "ins-after" : "ins-before");
    else el.classList.add(pos === "after" ? "ins-r" : "ins-l");
  }
  function nextPid(el, place) {
    let n = el.nextElementSibling;
    while (n && !(n.dataset && n.dataset.pid && n.dataset.place === place)) n = n.nextElementSibling;
    return n ? n.dataset.pid : null;
  }
  const sameBlock = (sr) => DRAG && DRAG.kind === "src" && DRAG.el && sr.closest("#srcRows") && sr.parentElement === DRAG.el.parentElement;
  document.addEventListener("dragover", (e) => {
    if (!DRAG) return;
    const sr = e.target.closest?.("tr.src");
    if (sr && sameBlock(sr)) { e.preventDefault(); markIns(sr, insPos(sr, e)); return; }
    const z = e.target.closest?.(".dz"); if (!z) return;
    if (!ok(DRAG.scope, z.dataset.drop)) return;
    e.preventDefault();
    document.querySelectorAll(".dz.over").forEach((x) => x !== z && x.classList.remove("over"));
    z.classList.add("over");
    const pe = e.target.closest("[data-pid]");
    if (pe && pe.dataset.place === z.dataset.drop) markIns(pe, insPos(pe, e)); else clearIns();
  });
  document.addEventListener("dragleave", (e) => { const z = e.target.closest?.(".dz"); if (z && !z.contains(e.relatedTarget)) z.classList.remove("over"); });
  document.addEventListener("drop", async (e) => {
    if (!DRAG) return;
    const sr = e.target.closest?.("tr.src");
    if (sr && sameBlock(sr)) {
      e.preventDefault();
      if (sr !== DRAG.el) { (insPos(sr, e) === "after" ? sr.after(DRAG.el) : sr.before(DRAG.el)); saveSrcOrder(sr.parentElement); status("データ項目の並び順を保存しました"); }
      clearIns(); DRAG = null; return;
    }
    const z = e.target.closest?.(".dz"); if (!z) return;
    e.preventDefault(); z.classList.remove("over");
    const place = z.dataset.drop;
    const pe = e.target.closest("[data-pid]");
    let before = null;
    if (pe && pe.dataset.place === place) before = insPos(pe, e) === "after" ? nextPid(pe, place) : pe.dataset.pid;
    clearIns(); document.body.classList.remove("dragging");
    const drag = DRAG; DRAG = null;
    try {
      if (drag.kind === "src") await send("/api/pins", { scope: drag.scope, file: drag.file, key: drag.key, label: drag.label, place, before });
      else if (before !== drag.id) await send("/api/pins/" + encodeURIComponent(drag.id), drag.place === place ? { before: before || "" } : { place, before: before || "" }, "PATCH");
      await afterPins(); status(`「${PLACE[place]}」に設定しました`);
    } catch (er) { status(er.message, true); }
  });
  function autoLabel(k) {
    const m = k.match(/([^/@\[\]]+)(?:\[(\d+)\])?(?:@(\w+))?$/);
    return m ? m[1] + (m[2] != null ? m[2] : "") : k;
  }

  let POP = null;
  function openPop(tr, btn) {
    POP = { scope: tr.dataset.scope, file: tr.dataset.file, key: tr.dataset.key };
    $("pinKey").textContent = `${POP.file} : ${POP.key}\n= ${tr.dataset.val}`;
    $("pinLabel").value = tr.dataset.label || autoLabel(POP.key);
    $("pinPlace").innerHTML = Object.keys(PLACE).filter((pl) => ok(POP.scope, pl)).map((pl) => `<option value="${pl}">${PLACE[pl]}</option>`).join("");
    $("pinAllWrap").hidden = !/\[\d+\]/.test(POP.key); $("pinAll").checked = false;
    const r = btn.getBoundingClientRect(), pop = $("pinPop");
    pop.hidden = false;
    pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left - pop.offsetWidth)) + "px";
    pop.style.top = Math.max(8, Math.min(window.innerHeight - pop.offsetHeight - 8, r.top - 10)) + "px";
    $("pinLabel").focus(); $("pinLabel").select();
  }
  $("pinPop").addEventListener("submit", async (e) => {
    e.preventDefault(); if (!POP) return;
    let k = POP.key; if ($("pinAll").checked) k = k.replace(/\[\d+\]/g, "[*]");
    try { await send("/api/pins", { ...POP, key: k, label: $("pinLabel").value.trim(), place: $("pinPlace").value }); $("pinPop").hidden = true; await afterPins(); }
    catch (er) { status(er.message, true); }
  });
  $("pinCancel").addEventListener("click", () => { $("pinPop").hidden = true; });
  document.addEventListener("click", async (e) => {
    const fb = e.target.closest("button[data-fmt]");
    if (fb) {
      e.stopPropagation();
      const p = S.pins.find((x) => x.id === fb.dataset.fmt); if (!p || !FMT[p.key]) return;
      const opts = FMT[p.key], i = opts.findIndex((o) => o[0] === p.fmt);
      try { await send("/api/pins/" + encodeURIComponent(p.id), { fmt: opts[(Math.max(0, i) + 1) % opts.length][0] }, "PATCH"); await afterPins(); } catch (er) { status(er.message, true); }
      return;
    }
    const un = e.target.closest("[data-unpin]");
    if (un) {
      e.stopPropagation();
      try { await api("/api/pins/" + encodeURIComponent(un.dataset.unpin), { method: "DELETE" }); await afterPins(); } catch (er) { status(er.message, true); }
      return;
    }
    if (!$("pinPop").hidden && !e.target.closest("#pinPop")) $("pinPop").hidden = true;
  });
  document.addEventListener("dblclick", async (e) => {
    const el = e.target.closest("[data-pid]"); if (!el || e.target.closest(".th")) return;
    const p = S.pins.find((x) => x.id === el.dataset.pid); if (!p) return;
    const v = prompt("表示名", p.label); if (v == null) return;
    await send("/api/pins/" + encodeURIComponent(p.id), { label: v.trim() }, "PATCH"); await afterPins();
  });
  $("btnReset").addEventListener("click", async () => {
    if (!confirm("表示項目の設定を初期状態に戻しますか？")) return;
    await send("/api/pins/reset", {}); await afterPins();
  });
  async function afterPins() {
    S.pins = await api("/api/pins");
    renderPinZones(); renderSources();
    if (S.lot) { const gen = S.gen; await loadLotInfo(gen); await loadImgMap(gen); }
    refreshSummaries();
  }

  // ================================================================ map (face lanes, class marks, pair lines)
  async function loadMap(gen) {
    if (!S.lot || !S.group) return;
    let d;
    try { d = await api("/api/map?" + q({ lot: S.lot.path, g: S.group })); } catch (e) { return; }
    if (gen !== S.gen) return;
    S.map = d; S.phase.map = "done"; loadProgress();
    $("mapMsg").textContent = d.ok ? "" : d.msg;
    $("mapTitle").textContent = d.ok ? `${d.points.length}件（画像あり ${d.points.filter((p) => p[4]).length}）` : "";
    renderMapSide();
    drawMap();
  }
  function mapGeom() {
    const cv = $("map"), pts = S.map.points;
    const sides = S.mapSide === "all" ? sideList().filter((s) => pts.some((p) => p[2] === s) || S.sides[s]) : [+S.mapSide];
    const W = cv.clientWidth, H = cv.clientHeight, gap = 8, top = 16, left = 40, pad = 5;
    const lw = (W - left - gap * Math.max(0, sides.length - 1)) / Math.max(1, sides.length);
    let x0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    x0 = Math.min(0, x0); if (x0 === x1) x1 = x0 + 1;
    const y0 = 0; y1 = Math.max(y1, S.map.len_m || 0, 1);
    const lane = (s) => sides.indexOf(s);
    return { W, H, sides, lw, top, left, gap, x0, x1, y0, y1,
      sx: (p) => left + lane(p[2]) * (lw + gap) + pad + ((p[0] - x0) / (x1 - x0)) * (lw - pad * 2),
      sy: (p) => top + pad + ((p[1] - y0) / (y1 - y0)) * (H - top - pad * 2) };
  }
  function drawMap() {
    const cv = $("map"), dpr = window.devicePixelRatio || 1;
    cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr;
    const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, cv.width, cv.height);
    $("mapLegend").innerHTML = "";
    if (!S.map || !S.map.ok || !S.map.points.length) return;
    const g = mapGeom();
    const sub = getComputedStyle(document.body).getPropertyValue("--sub");
    g.sides.forEach((s, i) => {
      const x = g.left + i * (g.lw + g.gap);
      c.fillStyle = "rgba(127,127,127,.08)"; c.fillRect(x, g.top, g.lw, g.H - g.top);
      c.strokeStyle = sideColor(s); c.lineWidth = 1.5; c.strokeRect(x + .5, g.top + .5, g.lw - 1, g.H - g.top - 1);
      c.fillStyle = sideColor(s); c.font = "bold 11px 'Yu Gothic UI'"; c.fillText(sideName(s), x + 2, 11);
    });
    c.fillStyle = sub; c.font = "10px Consolas";
    for (let k = 0; k <= 4; k++) {
      const v = g.y0 + ((g.y1 - g.y0) * k) / 4;
      const y = g.top + 5 + ((g.H - g.top - 10) * k) / 4;
      c.fillText(v >= 100 ? Math.round(v) : v.toFixed(1), 0, y + 3);
    }
    const want = (p) => g.sides.includes(p[2]);
    const byI = new Map(S.map.points.map((p) => [p[6], p]));
    // transfer candidate lines (front <-> back)
    if (S.P && S.P.ok && g.sides.length > 1) {
      const line = (a, b, col, w) => { const pa = byI.get(a), pb = byI.get(b); if (!pa || !pb || !want(pa) || !want(pb)) return; c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(g.sx(pa), g.sy(pa)); c.lineTo(g.sx(pb), g.sy(pb)); c.stroke(); };
      if (S.view === "pairs") for (const pr of S.plistPairs) line(pr[0], pr[1], "rgba(225,120,0,.35)", 1);
      if (S.psel) line(S.psel[0], S.psel[1], "#e07800", 2.5);
    }
    if (S.map.bands?.length) {
      const span = (g.H - g.top - 10) / Math.max(1e-9, g.y1 - g.y0);
      c.fillStyle = "rgba(198,40,40,.28)";
      for (const [xa, xb, y, len, side] of S.map.bands) {
        if (!g.sides.includes(side)) continue;
        const p1 = [xa, y, side], p2 = [xb, y, side];
        const x1 = g.sx(p1), x2 = g.sx(p2), yy = g.sy(p1);
        c.fillRect(Math.min(x1, x2), yy - 1, Math.max(2, Math.abs(x2 - x1)), Math.max(2, len * span));
      }
    }
    if (S.view === "pitch" && S.PT?.ok) {
      c.strokeStyle = "rgba(123,63,181,.35)"; c.lineWidth = 1;
      for (const ch of S.PT.chains) {
        const ps = ch.members.map((m) => byI.get(m.i)).filter((p) => p && want(p));
        c.beginPath(); ps.forEach((p, k) => (k ? c.lineTo(g.sx(p), g.sy(p)) : c.moveTo(g.sx(p), g.sy(p)))); c.stroke();
      }
    }
    c.textAlign = "center"; c.textBaseline = "middle"; c.font = `${S.ms}px 'Yu Gothic UI'`;
    const hs = Math.max(7, S.ms * 0.65);
    for (const p of S.map.points) {
      if (!want(p)) continue;
      const k = kindOf(p[3]);
      c.fillStyle = p[4] ? k.color : "rgba(120,120,120,.5)";
      c.fillText(k.mark || "●", g.sx(p), g.sy(p));
    }
    c.textAlign = "start"; c.textBaseline = "alphabetic";
    const it = S.items[S.cur];
    if (it && S.view === "grid") {
      const p = S.map.points.find((p) => p[4] === mkey(it));
      if (p && want(p)) { c.strokeStyle = "#1e5aa8"; c.lineWidth = 2; c.strokeRect(g.sx(p) - hs, g.sy(p) - hs, hs * 2, hs * 2); }
    }
    if (S.psel && S.view === "pairs") for (const i of S.psel) {
      const p = byI.get(i);
      if (p && want(p)) { c.strokeStyle = "#e07800"; c.lineWidth = 2; c.strokeRect(g.sx(p) - hs, g.sy(p) - hs, hs * 2, hs * 2); }
    }
    if (S.ptsel && S.view === "pitch") {
      const ch = S.PT?.chains?.[S.ptsel[0]];
      if (ch) {
        const ps = ch.members.map((m) => byI.get(m.i)).filter((p) => p && want(p));
        c.strokeStyle = "#7b3fb5"; c.lineWidth = 2; c.beginPath();
        ps.forEach((p, k) => (k ? c.lineTo(g.sx(p), g.sy(p)) : c.moveTo(g.sx(p), g.sy(p)))); c.stroke();
        for (const p of ps) c.strokeRect(g.sx(p) - hs, g.sy(p) - hs, hs * 2, hs * 2);
        const sp = byI.get(ch.members[S.ptsel[1]]?.i);
        if (sp && want(sp)) { c.strokeStyle = "#e07800"; c.lineWidth = 3; c.strokeRect(g.sx(sp) - hs - 2, g.sy(sp) - hs - 2, hs * 2 + 4, hs * 2 + 4); }
      }
    }
    const used = [...new Set(S.map.points.filter(want).map((p) => String(p[3])))].sort((a, b) => a - b);
    const lab = S.map.labels || {};
    $("mapLegend").innerHTML = used.map((v) => { const k = kindOf(v); return `<span><b style="color:${k.color}">${esc(k.mark)}</b> ${esc(k.name)} ${S.map.points.filter((p) => want(p) && String(p[3]) === v).length}</span>`; }).join("") +
      (S.map.bands?.length ? `<span title="多量（処理落ち）の範囲"><i style="background:rgba(198,40,40,.5);border-radius:0;width:12px"></i>多量 ${S.map.bands.length}</span>` : "") + (S.view === "pairs" ? `<span style="color:#e07800">― 転写候補</span>` : "") + (S.view === "pitch" ? `<span style="color:#7b3fb5">― ピッチ</span>` : "") +
      `<span>縦:${esc(lab.mapy || "")} 横:${esc(lab.mapx || "")}</span>`;
  }
  $("map").addEventListener("click", (e) => {
    if (!S.map?.ok) return;
    const r = $("map").getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, g = mapGeom();
    let best = null, bd = 1e9;
    for (const p of S.map.points) { if (!g.sides.includes(p[2])) continue; if (S.view === "grid" && !p[4]) continue; const d = (g.sx(p) - mx) ** 2 + (g.sy(p) - my) ** 2; if (d < bd) { bd = d; best = p; } }
    if (!best || bd >= 300) return;
    if (S.view === "pitch") {
      const ci = (S.PT?.chains || []).findIndex((ch) => ch.members.some((m) => m.i === best[6]));
      if (ci >= 0) selPitch(ci, S.PT.chains[ci].members.findIndex((m) => m.i === best[6]));
      return;
    }
    if (S.view === "pairs") {
      const gi = S.plist.findIndex((x) => x.base.i === best[6]);
      if (gi >= 0) { selPair(gi, 0); return; }
      for (let a = 0; a < S.plist.length; a++) { const ci = S.plist[a].cands.findIndex((c) => c.d.i === best[6]); if (ci >= 0) { selPair(a, ci); return; } }
      return;
    }
    const [cab, name] = best[4].split("/"); select(S.items.findIndex((x) => x.cab === cab && x.name === name));
  });
  $("map").addEventListener("dblclick", () => { if (S.view === "pairs") openPV(); else if (S.cur >= 0) openViewer(); });
  // mark size
  $("markSize").value = S.ms;
  $("markSize").addEventListener("input", () => { S.ms = Math.max(6, Math.min(28, +$("markSize").value || 11)); localStorage.setItem("mapMark", S.ms); drawMap(); });

  // ================================================================ transfer candidates
  const PV = { base: localStorage.getItem("pBase") || "front" };
  ["pTol", "pMaxDy"].forEach((id) => { const v = localStorage.getItem(id); if (v != null) $(id).value = v; });
  $("pTolR").value = $("pTol").value;
  $("pMirror").checked = localStorage.getItem("pMirror") === "1";
  $("pImgOnly").checked = localStorage.getItem("pImgOnly") !== "0";
  $("pSort").value = localStorage.getItem("pSort") || "y";
  const fmt2 = (v) => (v == null ? "—" : Number(v).toFixed(2));
  const sgn = (v, d = 2) => (v > 0 ? "+" : v < 0 ? "−" : "±") + Math.abs(v).toFixed(d);

  function setView(v) {
    S.view = v;
    document.querySelectorAll("#viewSeg button").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
    $("grid").hidden = v !== "grid"; $("pairView").hidden = v !== "pairs"; $("pitchView").hidden = v !== "pitch"; $("listView").hidden = v !== "list";
    $("loadBand").classList.toggle("off", v === "list");   // 画像の読み込みの帯は画像の画面だけ
    if (v === "list") window.DTLotList.setScope(listScope());
    document.querySelector(".cardzone").style.display = v === "grid" ? "" : "none";
    $("sizerWrap").style.display = v === "grid" ? "" : "none";
    if (v === "pairs") { if (S.mapSide !== "all") { S.mapSide = "all"; renderMapSide(); } renderPairs(); }
    if (v === "pitch") renderPitch();
    drawMap();
  }
  $("viewSeg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setView(b.dataset.v); });
  $("baseSeg").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.b === PV.base));
  $("baseSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    PV.base = b.dataset.b; localStorage.setItem("pBase", PV.base);
    $("baseSeg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    S.pshow = 150; S.pselRef = null; S.psel = null; renderPairs();
  });
  let pTimer = null;
  const reload = () => { clearTimeout(pTimer); pTimer = setTimeout(() => loadPairs(S.gen), 250); };
  $("pTol").addEventListener("input", () => { $("pTolR").value = $("pTol").value; localStorage.setItem("pTol", $("pTol").value); reload(); });
  $("pTolR").addEventListener("input", () => { $("pTol").value = $("pTolR").value; localStorage.setItem("pTol", $("pTol").value); reload(); });
  $("pMaxDy").addEventListener("input", () => { localStorage.setItem("pMaxDy", $("pMaxDy").value); reload(); });
  $("pMirror").addEventListener("change", () => { localStorage.setItem("pMirror", $("pMirror").checked ? "1" : "0"); reload(); });
  $("pImgOnly").addEventListener("change", () => { localStorage.setItem("pImgOnly", $("pImgOnly").checked ? "1" : "0"); S.pshow = 150; renderPairs(); });
  $("pSort").addEventListener("change", () => { localStorage.setItem("pSort", $("pSort").value); renderPairs(); });

  async function loadPairs(gen) {
    if (!S.lot) return;
    const tol = Math.max(0, parseFloat($("pTol").value) || 0);
    const md = $("pMaxDy").value.trim();
    let d;
    try { d = await api("/api/pairs?" + q({ lot: S.lot.path, g: S.group || "img", tol, maxdy: md, mirror: $("pMirror").checked ? 1 : 0 })); }
    catch (e) { $("pSum").textContent = e.message; return; }
    if (gen !== S.gen) return;
    S.P = d; S.phase.pairs = "done"; loadProgress();
    S.D = new Map((d.defects || []).map((x) => [x.i, x]));
    S.pairN = {};
    for (const [f, b] of d.pairs || []) { S.pairN[f] = (S.pairN[f] || 0) + 1; S.pairN[b] = (S.pairN[b] || 0) + 1; }
    $("pairCnt").textContent = d.ok ? `${d.pairs.length}` : "";
    S.pselRef = null; S.psel = null;
    updateCards();
    const t = S.items[S.cur]; if (t) { const el = document.querySelector(`.th[data-key="${CSS.escape(key(t))}"]`); if (el) el.classList.add("sel"); }
    // 一覧は見ているときだけ描く（候補が数万組あると描くのに 0.5 秒かかる。切り替えたとき setView が描く）
    if (S.view === "pairs") renderPairs();
  }

  function groupsOf() {
    const d = S.P; if (!d || !d.ok) return [];
    const imgOnly = $("pImgOnly").checked;
    const fb = PV.base === "front";
    const okd = (x) => !imgOnly || x.img;
    const map = new Map();
    for (const [f, b, dx, dy] of d.pairs) {
      const fd = S.D.get(f), bd = S.D.get(b);
      const [base, cand] = fb ? [fd, bd] : [bd, fd];
      if (!okd(base) || !okd(cand)) continue;
      if (!map.has(base.i)) map.set(base.i, { base, cands: [] });
      map.get(base.i).cands.push({ d: cand, dx: fb ? dx : -dx, dy: fb ? dy : -dy, f, b });
    }
    const cnt = new Map();
    for (const g of map.values()) for (const c of g.cands) cnt.set(c.d.i, (cnt.get(c.d.i) || 0) + 1);
    const arr = [...map.values()];
    for (const g of arr) {
      g.cands.sort((a, b) => Math.abs(a.dy) - Math.abs(b.dy));
      for (const c of g.cands) c.dup = cnt.get(c.d.i);
      g.mdx = Math.min(...g.cands.map((c) => Math.abs(c.dx)));
      g.mdy = Math.min(...g.cands.map((c) => Math.abs(c.dy)));
    }
    const so = $("pSort").value;
    arr.sort(so === "n" ? (a, b) => b.cands.length - a.cands.length || a.base.y - b.base.y
      : so === "dx" ? (a, b) => a.mdx - b.mdx : so === "dy" ? (a, b) => a.mdy - b.mdy : (a, b) => a.base.y - b.base.y);
    return arr;
  }

  const thumbUrl = (d) => { if (!d.img) return null; const [cab, name] = d.img.split("/"); return "/thumb?" + q({ lot: S.lot.path, g: S.group || "img", cab, name }); };
  const faceTag = (d) => `<span class="face" style="background:${sideColor(d.side)}">${esc(sideName(d.side))}</span>`;
  function dcard(d, extra = "") {
    const u = thumbUrl(d);
    return `<div class="dcard" style="--sc:${sideColor(d.side)}" data-di="${d.i}">${u ? `<img loading="lazy" src="${u}" alt="">` : '<div class="noimg">画像なし</div>'}
      <div class="dt"><div class="h">${faceTag(d)}<span class="n">No.${esc(d.no)}</span><span>${esc(d.kname)}<span class="mk" style="color:${d.kcolor}">${esc(d.kmark)}</span></span>${extra}</div>
      <div>幅方向OS～ <b class="n">${fmt2(d.x)}</b> mm</div><div>長さ方向 <b class="n">${fmt2(d.y)}</b> m</div><div>面積 <span class="n">${fmt2(d.a)}</span> mm²</div></div></div>`;
  }

  function renderPairs() {
    const box = $("pairList");
    const d = S.P;
    if (!d) { box.innerHTML = '<div class="empty">ロットを選択してください</div>'; return; }
    if (!d.ok) { box.innerHTML = `<div class="empty">${esc(d.msg)}</div>`; $("pSum").textContent = ""; return; }
    const groups = groupsOf();
    S.plist = groups;
    S.plistPairs = groups.flatMap((g) => g.cands.map((c) => [c.f, c.b]));
    const npair = S.plistPairs.length;
    const bname = PV.base === "front" ? sideName(d.front) : sideName(d.back);
    const nbase = PV.base === "front" ? d.nf : d.nb;
    const multi = groups.filter((g) => g.cands.length > 1).length;
    $("pSum").innerHTML = `${esc(bname)} <b>${nbase}</b>件中 <b>${groups.length}</b>件に候補 ／ ペア <b>${npair}</b>組 ／ 複数候補 <b>${multi}</b>件 ／ 条件：幅差 ±${esc($("pTol").value)}mm${$("pMaxDy").value ? `・長さ差 ≤ ${esc($("pMaxDy").value)}m` : ""}${d.mirror ? "・裏反転" : ""}${$("pImgOnly").checked ? "・画像ありのみ" : ""}${d.final ? "" : "（画像展開中）"}` +
      (d.scan?.known ? ` ／ <span title="cond/SystemCond.xml の scan_direction">スキャン方向：${d.scan.same ? "表裏同一（反転不要）" : "表裏逆（反転ONを推奨）"}</span>` : "");
    if (!groups.length) {
      box.innerHTML = `<div class="empty">条件に合う転写候補はありません。${d.nf && d.nb ? "幅差の許容を広げると候補が増えます。" : `（表 ${d.nf}件・裏 ${d.nb}件：片面のみのため組を作れません）`}</div>`;
      drawMap(); return;
    }
    const tol = Math.max(0.5, parseFloat($("pTol").value) || 0.5);
    box.innerHTML = groups.slice(0, S.pshow).map((g, gi) => {
      const n = g.cands.length;
      const head = `<span class="badge${n > 1 ? " many" : ""}">候補 ${n}</span>`;
      const rows = g.cands.map((c, ci) => {
        const pos = Math.max(0, Math.min(100, 50 + (c.dx / tol) * 50));
        return `<div class="pc" data-g="${gi}" data-c="${ci}" title="クリックでMAPに表示／ダブルクリックで並べて比較">
          ${dcard(c.d, c.dup > 1 ? `<span class="dup" title="この欠陥は${c.dup}件の${esc(bname)}欠陥の候補になっています">他でも候補 ×${c.dup}</span>` : "")}
          <div class="dl"><div><span class="lab">転写距離（長さ差）</span></div><b>${sgn(c.dy)}</b> m<div class="sub">${fmt2(g.base.y)} → ${fmt2(c.d.y)}</div></div>
          <div class="dl"><div><span class="lab">幅差</span><b>${sgn(c.dx)}</b> mm</div><div class="dxbar" title="許容 ±${tol}mm 内の位置"><i style="left:${pos}%"></i></div><div class="sub">${fmt2(g.base.x)} / ${fmt2(c.d.x)}</div></div>
        </div>`;
      }).join("");
      return `<div class="pg" data-g="${gi}">${dcard(g.base, head)}<div class="pcs">${rows}</div></div>`;
    }).join("") + (groups.length > S.pshow ? `<button type="button" class="more" id="pMore">さらに表示（残り ${groups.length - S.pshow} 件）</button>` : "");
    markPairSel();
    drawMap();
  }

  function markPairSel() {
    document.querySelectorAll(".pc.sel,.pg.sel").forEach((x) => x.classList.remove("sel"));
    if (!S.pselRef) return;
    const el = document.querySelector(`.pc[data-g="${S.pselRef[0]}"][data-c="${S.pselRef[1]}"]`);
    if (el) { el.classList.add("sel"); el.closest(".pg").classList.add("sel"); el.scrollIntoView({ block: "nearest" }); }
  }
  function selPair(gi, ci) {
    const g = S.plist[gi]; if (!g) return;
    const c = g.cands[ci]; if (!c) return;
    if (gi >= S.pshow) { S.pshow = gi + 50; S.pselRef = [gi, ci]; renderPairs(); }
    S.pselRef = [gi, ci]; S.psel = [c.f, c.b];
    markPairSel(); drawMap();
    const d = g.base.img ? g.base : c.d.img ? c.d : null;
    if (d) {
      const [cab, name] = d.img.split("/");
      const i = S.items.findIndex((x) => x.cab === cab && x.name === name);
      if (i >= 0) { S.cur = i; $("imgTitle").textContent = `${cab}/${name}`; loadImgInfo(S.items[i]); }
    }
    if (!$("pv").hidden) showPV();
  }
  function flatIdx() { const out = []; S.plist.forEach((g, gi) => g.cands.forEach((_, ci) => out.push([gi, ci]))); return out; }
  function stepPair(dir) {
    const fl = flatIdx(); if (!fl.length) return;
    let k = S.pselRef ? fl.findIndex(([a, b]) => a === S.pselRef[0] && b === S.pselRef[1]) : -1;
    k = Math.max(0, Math.min(fl.length - 1, k + dir));
    selPair(...fl[k]);
  }
  $("pairList").addEventListener("click", (e) => {
    if (e.target.id === "pMore") { S.pshow += 150; renderPairs(); return; }
    const pc = e.target.closest(".pc");
    if (pc) { selPair(+pc.dataset.g, +pc.dataset.c); return; }
    const pg = e.target.closest(".pg");
    if (pg) selPair(+pg.dataset.g, 0);
  });
  $("pairList").addEventListener("dblclick", (e) => {
    const pc = e.target.closest(".pc"), pg = e.target.closest(".pg");
    if (pc) selPair(+pc.dataset.g, +pc.dataset.c); else if (pg) selPair(+pg.dataset.g, 0); else return;
    openPV();
  });

  // image card badge -> candidates of that defect
  $("grid").addEventListener("click", (e) => {
    const b = e.target.closest(".tbadge"); if (!b || !S.P) return;
    e.stopPropagation();
    const di = +b.dataset.pairs, d = S.D.get(di); if (!d) return;
    const wantBase = d.side === S.P.front ? "front" : "back";
    if (PV.base !== wantBase) { PV.base = wantBase; localStorage.setItem("pBase", wantBase); $("baseSeg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.b === wantBase)); }
    $("pImgOnly").checked = false; S.pshow = 100000;
    setView("pairs");
    const gi = S.plist.findIndex((g) => g.base.i === di);
    if (gi >= 0) selPair(gi, 0);
  }, true);

  // pair viewer (side by side)
  function pvSide(d, role) {
    const u = d.img ? (() => { const [cab, name] = d.img.split("/"); return "/img?" + q({ lot: S.lot.path, g: S.group || "img", cab, name }); })() : null;
    return `<div class="ph2">${faceTag(d)}<b>No.${esc(d.no)}</b><span>${esc(d.kname)}<span class="mk" style="color:${d.kcolor}">${esc(d.kmark)}</span></span>
      <span>幅方向OS～ <b>${fmt2(d.x)}</b>mm</span><span>長さ方向 <b>${fmt2(d.y)}</b>m</span><span>面積 ${fmt2(d.a)}mm²</span><span class="sub">${esc(role)}${d.img ? " / " + esc(d.img) : ""}</span></div>
      <div class="im">${u ? `<img src="${u}" alt="">` : '<span class="noimg">画像なし</span>'}</div>`;
  }
  function showPV() {
    const g = S.plist[S.pselRef?.[0]]; if (!g) return;
    const c = g.cands[S.pselRef[1]];
    const fl = flatIdx(), k = fl.findIndex(([a, b]) => a === S.pselRef[0] && b === S.pselRef[1]);
    $("pvTitle").textContent = `転写候補比較  ${S.lot.eq} ${lotPins("summary")[0]?.value || ""}  (${k + 1}/${fl.length})`;
    $("pvDelta").innerHTML = `<span>転写距離（長さ差） <b>${sgn(c.dy)}</b> m</span><span>幅差 <b>${sgn(c.dx)}</b> mm</span><span>${esc(sideName(g.base.side))}No.${esc(g.base.no)} の候補 ${g.cands.length}件中 ${S.pselRef[1] + 1}件目</span>`;
    $("pvA").innerHTML = pvSide(g.base, "基準"); $("pvA").style.setProperty("--sc", sideColor(g.base.side));
    $("pvB").innerHTML = pvSide(c.d, "候補"); $("pvB").style.setProperty("--sc", sideColor(c.d.side));
  }
  function openPV() { if (!S.pselRef) stepPair(1); if (!S.pselRef) return; $("pv").hidden = false; showPV(); }
  $("pvClose").addEventListener("click", () => { $("pv").hidden = true; });
  $("pvPrev").addEventListener("click", () => stepPair(-1));
  $("pvNext").addEventListener("click", () => stepPair(1));

  $("pCsv").addEventListener("click", () => {
    if (!S.plist.length) { status("出力する転写候補がありません", true); return; }
    const rows = [["基準面", "基準No", "基準分類", "基準幅方向OS(mm)", "基準長さ方向(m)", "基準面積(mm2)", "基準画像", "候補面", "候補No", "候補分類", "候補幅方向OS(mm)", "候補長さ方向(m)", "候補面積(mm2)", "候補画像", "幅差(mm)", "転写距離_長さ差(m)", "基準の候補数", "候補の重複数"]];
    for (const g of S.plist) for (const c of g.cands) {
      const b = g.base, d = c.d;
      rows.push([sideName(b.side), b.no, b.kname, b.x, b.y, b.a, b.img || "", sideName(d.side), d.no, d.kname, d.x, d.y, d.a, d.img || "", c.dx, c.dy, g.cands.length, c.dup]);
    }
    const csv = "\ufeff" + rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    TPA.download(new Blob([csv], { type: "text/csv" }), `転写候補_${S.lot?.eq || ""}_${S.lot?.name || ""}.csv`);
  });


  // ================================================================ pitch detection (same face)
  ["ptTol", "ptYtol", "ptN", "ptPmin", "ptPmax", "ptSkip"].forEach((id) => { const v = localStorage.getItem(id); if (v != null) $(id).value = v; });
  $("ptTolR").value = $("ptTol").value;
  $("ptImgOnly").checked = localStorage.getItem("ptImgOnly") === "1";
  $("ptSort").value = localStorage.getItem("ptSort") || "n";
  let ptTimer = null;
  const ptReload = () => { clearTimeout(ptTimer); ptTimer = setTimeout(() => loadPitch(S.gen), 250); };
  ["ptTol", "ptYtol", "ptN", "ptPmin", "ptPmax", "ptSkip"].forEach((id) => $(id).addEventListener("input", () => { localStorage.setItem(id, $(id).value); if (id === "ptTol") $("ptTolR").value = $(id).value; ptReload(); }));
  $("ptTolR").addEventListener("input", () => { $("ptTol").value = $("ptTolR").value; localStorage.setItem("ptTol", $("ptTol").value); ptReload(); });
  $("ptImgOnly").addEventListener("change", () => { localStorage.setItem("ptImgOnly", $("ptImgOnly").checked ? "1" : "0"); renderPitch(); });
  $("ptSort").addEventListener("change", () => { localStorage.setItem("ptSort", $("ptSort").value); renderPitch(); });

  async function loadPitch(gen) {
    if (!S.lot) return;
    let d;
    try {
      d = await api("/api/pitch?" + q({ lot: S.lot.path, g: S.group || "img", tol: $("ptTol").value, ytol: $("ptYtol").value,
        n: $("ptN").value, pmin: $("ptPmin").value, pmax: $("ptPmax").value, skip: $("ptSkip").value }));
    } catch (e) { $("ptSum").textContent = e.message; return; }
    if (gen !== S.gen) return;
    S.PT = d; S.ptsel = null; S.phase.pitch = "done"; loadProgress();
    $("pitchCnt").textContent = d.ok ? `${d.chains.length}` : "";
    if (S.view === "pitch") renderPitch();
  }
  function pitchRows() {
    const d = S.PT; if (!d || !d.ok) return [];
    let rows = d.chains.map((c, i) => ({ c, i }));
    if ($("ptImgOnly").checked) rows = rows.filter((r) => r.c.members.every((m) => m.img));
    const so = $("ptSort").value;
    rows.sort(so === "y" ? (a, b) => a.c.y0 - b.c.y0 : so === "p" ? (a, b) => a.c.pitch - b.c.pitch : so === "dev" ? (a, b) => a.c.dev - b.c.dev : (a, b) => b.c.n - a.c.n || a.c.y0 - b.c.y0);
    return rows;
  }
  function renderPitch() {
    const box = $("pitchList"), d = S.PT;
    if (!d) { box.innerHTML = '<div class="empty">ロットを選択してください</div>'; return; }
    if (!d.ok) { box.innerHTML = `<div class="empty">${esc(d.msg)}</div>`; $("ptSum").textContent = ""; return; }
    const rows = pitchRows();
    S.ptRows = rows;
    const c = d.cond;
    const bySide = {};
    for (const r of rows) bySide[r.c.side] = (bySide[r.c.side] || 0) + 1;
    $("ptSum").innerHTML = `ピッチ候補 <b>${rows.length}</b>件（${Object.entries(bySide).map(([s, n]) => `${esc(sideName(+s))} ${n}`).join("・") || "—"}） ／ 条件：同一面・幅差 ±${c.tol}mm・ピッチ差 ±${c.ytol}m・${c.n}ピッチ以上（${c.n + 1}個以上）・ピッチ ${c.pmin}m${c.pmax != null ? `〜${c.pmax}m` : "以上"}${c.skip ? `・欠け許容${c.skip}` : ""}${d.final ? "" : "（画像展開中）"}`;
    if (!rows.length) { box.innerHTML = '<div class="empty">条件に合うピッチ候補はありません。幅差・ピッチ差の許容を広げるか、最小ピッチ数を減らすと候補が増えます。</div>'; drawMap(); return; }
    box.innerHTML = rows.map(({ c, i }) => {
      const strip = c.members.map((m, k) => {
        const u = thumbUrl(m);
        const gap = k < c.intervals.length ? `<div class="ptgap"><span>${c.gaps[k] > 1 ? `×${c.gaps[k]} ` : ""}${c.intervals[k].toFixed(3)} m</span><i style="--dv:${Math.min(100, Math.abs(c.intervals[k] - c.pitch * c.gaps[k]) / Math.max(1e-6, c.dev || 1e-6) * 100)}%" title="ピッチとの差 ${sgn(c.intervals[k] - c.pitch * c.gaps[k], 3)} m"></i></div>` : "";
        return `<div class="ptm" data-c="${i}" data-k="${k}" title="No.${esc(m.no)} ${esc(m.kname)}  幅 ${fmt2(m.x)}mm  長さ ${m.y.toFixed(3)}m">
          ${u ? `<img loading="lazy" src="${u}" alt="">` : '<div class="noimg">画像なし</div>'}
          <div class="pl"><span class="n">No.${esc(m.no)}</span><span class="mk" style="color:${m.kcolor}">${esc(m.kmark)}</span></div>
          <div class="pl sub">${m.y.toFixed(2)} m</div><div class="pl sub">${fmt2(m.x)} mm</div></div>${gap}`;
      }).join("");
      return `<div class="ptg" data-c="${i}" style="--sc:${sideColor(c.side)}">
        <div class="pth">${faceTag({ side: c.side })}
          <span class="big">ピッチ <b>${c.pitch.toFixed(3)}</b> m</span>
          <span>個数 <b>${c.n}</b>（${c.n - 1}ピッチ${c.gaps.some((g) => g > 1) ? "・欠けあり" : ""}）</span>
          <span>幅方向OS～ <b>${fmt2(c.x)}</b> mm（幅 ${fmt2(c.xr)}）</span>
          <span>長さ方向 ${c.y0.toFixed(2)} 〜 ${c.y1.toFixed(2)} m</span>
          <span>ピッチばらつき 最大 ±${c.dev.toFixed(3)} m</span>
          <span class="sub" title="ピッチ ÷ π（ロール外周がピッチの場合の直径）">推定ロール径 φ${c.dia.toFixed(1)} mm</span></div>
        <div class="ptstrip">${strip}</div></div>`;
    }).join("");
    markPitchSel();
    drawMap();
  }
  function markPitchSel() {
    document.querySelectorAll(".ptg.sel,.ptm.sel").forEach((x) => x.classList.remove("sel"));
    if (!S.ptsel) return;
    const g = document.querySelector(`.ptg[data-c="${S.ptsel[0]}"]`);
    if (g) { g.classList.add("sel"); const m = g.querySelector(`.ptm[data-k="${S.ptsel[1]}"]`); if (m) { m.classList.add("sel"); m.scrollIntoView({ block: "nearest", inline: "nearest" }); } }
  }
  function selPitch(ci, k) {
    const c = S.PT?.chains?.[ci]; if (!c) return;
    k = Math.max(0, Math.min(c.members.length - 1, k || 0));
    S.ptsel = [ci, k];
    markPitchSel(); drawMap();
    const m = c.members[k];
    if (m.img) { const [cab, name] = m.img.split("/"); const i = S.items.findIndex((x) => x.cab === cab && x.name === name); if (i >= 0) { S.cur = i; $("imgTitle").textContent = `${cab}/${name}`; loadImgInfo(S.items[i]); } }
  }
  function stepPitch(dr, dc) {
    const rows = S.ptRows || []; if (!rows.length) return;
    let r = S.ptsel ? rows.findIndex((x) => x.i === S.ptsel[0]) : -1, k = S.ptsel ? S.ptsel[1] : 0;
    if (r < 0) { r = 0; k = 0; } else if (dr) { r = Math.max(0, Math.min(rows.length - 1, r + dr)); k = 0; } else k += dc;
    selPitch(rows[r].i, k);
  }
  function openPitchMember() {
    if (!S.ptsel) return;
    const m = S.PT.chains[S.ptsel[0]].members[S.ptsel[1]];
    if (!m.img) return;
    const [cab, name] = m.img.split("/"); const i = S.items.findIndex((x) => x.cab === cab && x.name === name);
    if (i >= 0) { select(i); openViewer(); }
  }
  $("pitchList").addEventListener("click", (e) => {
    const m = e.target.closest(".ptm"); if (m) { selPitch(+m.dataset.c, +m.dataset.k); return; }
    const g = e.target.closest(".ptg"); if (g) selPitch(+g.dataset.c, 0);
  });
  $("pitchList").addEventListener("dblclick", (e) => { const m = e.target.closest(".ptm"); if (!m) return; selPitch(+m.dataset.c, +m.dataset.k); openPitchMember(); });
  $("ptCsv").addEventListener("click", () => {
    const rows = S.ptRows || [];
    if (!rows.length) { status("出力するピッチ候補がありません", true); return; }
    const out = [["候補No", "面", "ピッチ(m)", "個数", "ばらつき最大(m)", "平均幅方向OS(mm)", "推定ロール径(mm)", "順", "欠陥No", "分類", "幅方向OS(mm)", "長さ方向(m)", "面積(mm2)", "前との間隔(m)", "画像"]];
    rows.forEach(({ c }, ri) => c.members.forEach((m, k) => out.push([ri + 1, sideName(c.side), c.pitch, c.n, c.dev, c.x, c.dia, k + 1, m.no, m.kname, m.x, m.y, m.a, k ? c.intervals[k - 1] : "", m.img || ""])));
    const csv = "\ufeff" + out.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    TPA.download(new Blob([csv], { type: "text/csv" }), `ピッチ候補_${S.lot?.eq || ""}_${S.lot?.name || ""}.csv`);
  });

  // ================================================================ viewer
  const pre = new Map();
  const imgUrl = (it) => "/img?" + q({ lot: S.lot.path, g: it.g, cab: it.cab, name: it.name });
  function prefetch(i) { const it = S.items[i]; if (!it) return; const u = imgUrl(it); if (pre.has(u)) return; const im = new Image(); im.src = u; pre.set(u, im); if (pre.size > 30) pre.delete(pre.keys().next().value); }
  function openViewer() { if (S.cur < 0) return; $("viewer").hidden = false; showViewer(); renderImgInfo(); }
  function closeViewer() { $("viewer").hidden = true; $("grid").focus(); }
  function showViewer() {
    const it = S.items[S.cur], im = $("vImg");
    im.onload = () => { im.dataset.w = im.naturalWidth; im.dataset.h = im.naturalHeight; applyZoom(); };
    im.src = imgUrl(it);
    const m = S.imap[mkey(it)];
    $("vName").textContent = `${S.lot.eq}  ${lotPins("summary")[0]?.value || ""}  ${S.lot.name}  ${m && m.no != null ? "欠陥No:" + m.no + "  " + m.kname + " [" + m.sname + "]" : it.cab + "/" + it.name}  (${S.cur + 1}/${S.items.length})`;
    prefetch(S.cur + 1); prefetch(S.cur - 1);
  }
  function applyZoom() {
    const im = $("vImg");
    $("vStage").classList.toggle("fit", S.zoom === "fit");
    if (S.zoom === "fit" || !im.dataset.w) { im.style.width = ""; im.style.height = ""; return; }
    im.style.width = im.dataset.w * S.zoom + "px"; im.style.height = im.dataset.h * S.zoom + "px";
  }
  function setZoom(z) { S.zoom = z; document.querySelectorAll("#zoomSeg button").forEach((b) => b.classList.toggle("on", String(b.dataset.z) === String(z))); applyZoom(); }
  $("zoomSeg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setZoom(b.dataset.z === "fit" ? "fit" : Number(b.dataset.z)); });
  $("vStage").addEventListener("dblclick", () => setZoom(S.zoom === "fit" ? 2 : "fit"));
  $("vStage").addEventListener("wheel", (e) => {
    e.preventDefault();
    const st = [1, 2, 3, 4, 6, 8]; let z = S.zoom === "fit" ? 0 : st.indexOf(S.zoom);
    z = e.deltaY < 0 ? Math.min(st.length - 1, z + 1) : z - 1; setZoom(z < 0 ? "fit" : st[z]);
  }, { passive: false });
  $("vClose").addEventListener("click", closeViewer);
  $("vPrev").addEventListener("click", () => select(S.cur - 1));
  $("vNext").addEventListener("click", () => select(S.cur + 1));

  document.addEventListener("keydown", (e) => {
    // データ項目の窓が開いている間は、窓の中だけ（Esc で閉じる・Ctrl+F で探す欄へ）
    if (!$("srcModal").hidden) {
      if (e.key === "Escape") { if (!$("pinPop").hidden) $("pinPop").hidden = true; else closeSources(); e.preventDefault(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { $("srcFilter").focus(); $("srcFilter").select(); e.preventDefault(); }
      return;
    }
    if (e.target.closest("input,select,#pinPop")) { if (e.key === "Escape") $("pinPop").hidden = true; return; }
    if (S.view === "pitch" && $("viewer").hidden && $("pv").hidden) {
      if (e.key === "ArrowRight") { stepPitch(0, 1); e.preventDefault(); return; }
      if (e.key === "ArrowLeft") { stepPitch(0, -1); e.preventDefault(); return; }
      if (e.key === "ArrowDown") { stepPitch(1, 0); e.preventDefault(); return; }
      if (e.key === "ArrowUp") { stepPitch(-1, 0); e.preventDefault(); return; }
      if (e.key === "Enter") { openPitchMember(); e.preventDefault(); return; }
      return;
    }
    if (!$("pv").hidden || (S.view === "pairs" && $("viewer").hidden)) {
      if (e.key === "Escape") { $("pv").hidden = true; return; }
      if (e.key === "ArrowRight" || e.key === "ArrowDown") { stepPair(1); e.preventDefault(); return; }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") { stepPair(-1); e.preventDefault(); return; }
      if (e.key === "Enter") { openPV(); e.preventDefault(); return; }
      return;
    }
    if (e.key === "ArrowRight") { select(S.cur + 1); e.preventDefault(); }
    else if (e.key === "ArrowLeft") { select(S.cur - 1); e.preventDefault(); }
    else if (e.key === "Enter") { openViewer(); e.preventDefault(); }
    else if (e.key === "Escape" && !$("viewer").hidden) closeViewer();
  });
  $("treeFilter").addEventListener("input", applyFilter);
  const setListCfg = (open) => { document.querySelector(".listzone").classList.toggle("open", open); $("listCfg").setAttribute("aria-expanded", open); $("listCfg").textContent = open ? "項目▴" : "項目▾"; localStorage.setItem("listCfg", open ? "1" : "0"); };
  $("listCfg").addEventListener("click", () => setListCfg($("listCfg").getAttribute("aria-expanded") !== "true"));
  setListCfg(localStorage.getItem("listCfg") === "1");
  const ts = $("thumbSize");
  ts.value = localStorage.getItem("thumbSize") || 150;
  const setTs = () => { $("grid").style.setProperty("--ts", ts.value + "px"); localStorage.setItem("thumbSize", ts.value); };
  ts.addEventListener("input", setTs); setTs();
  window.addEventListener("resize", drawMap);

  // 保存（CSV・Excel・表示列の設定）は、どれも LotScope の部品と同じ TPA.download で行い、知らせも 1 つにそろえる。
  // 窓は保存し終えたとき dt:saved を送るので、TPA の知らせ（置いた場所・フォルダを開く・パスをコピー）へ渡す
  window.addEventListener("dt:saved", (e) => window.dispatchEvent(new CustomEvent("tpa:saved", { detail: e.detail })));

  (async () => {
    window.DTLotList.mount($("listView"), { onOpen: openLotPath });
    try { S.pins = await api("/api/pins"); renderPinZones(); renderMapSide(); await loadEquipments(); status("設備を選択してください"); }
    catch (e) { status(e.message, true); }
    // 画面が開けた合図（入れ替えた直後の版は、これが来なければ前の版へ戻す）
    window.__dtReady = true;
    fetch("/__desktop/ready", { method: "POST" }).catch(() => {});
  })();
})();
