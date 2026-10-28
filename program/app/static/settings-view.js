// 設定の窓（この PC・使用状況・配布・使用の履歴）と、使用状況の心拍・管理者からの「更新のお願い」の帯。
// 形は 3 回の案出しと別のエージェントの採点で決めた（N: program/tools/proposals/2026-10-28-settings*）:
//   大きさは決め打ち（頁を替えても窓の大きさは変わらず、中だけが送られる）・上の横の見出し「この PC ｜ 管理（開発者）: 使用状況・配布・使用の履歴」・
//   使用状況は 数の札 → 絞り込み → PC の表（要更新が上・行に「更新を促す」「履歴」「記録を消す」を同じ位置に）・
//   配布の頁の下に 版の行き渡り と 更新を促す相手・使用の履歴は 日ごとの使った PC の数 → PC で絞る → 表 → 記録を残す日数。
// 決まり（置き場・心拍・要更新・お願い）は program/docs/APP-MANAGEMENT.md。
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const say = (m, err) => { const s = $("status"); s.textContent = m; s.className = err ? "err" : ""; };
  async function call(url, opt) {
    const r = await fetch(url, opt);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `${r.status} ${r.statusText}`);
    return j;
  }
  const post = (url, body) => call(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  const tag = (cls, t, title) => `<span class="set-tag ${cls}"${title ? ` title="${esc(title)}"` : ""}>${t}</span>`;
  const ago = (sec) => (sec == null ? "—" : sec < 90 ? "いま" : sec < 3600 ? `${Math.round(sec / 60)} 分前` : sec < 86400 ? `${Math.round(sec / 3600)} 時間前` : `${Math.round(sec / 86400)} 日前`);
  const hours = (sec) => (sec < 3600 ? `${Math.max(1, Math.round(sec / 60))} 分` : `${Math.round(sec / 3600)} 時間`);
  const hm = (sec) => `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}`;
  const md = (t) => (t || "").replace(/^\d{4}-(\d\d)-(\d\d)T(\d\d:\d\d).*/, "$1/$2 $3");
  const LATER_MS = 4 * 3600 * 1000;   // 「あとで」でお願いの帯を畳む時間
  const S = { me: null, fleet: null, page: "pc", filter: "all", pcFilter: "" };

  // ---------------------------------------------------------------- 心拍（20 秒ごと。閉じるとき left）と、管理者からの「更新のお願い」
  async function beat() {
    try { const r = await post("/api/heartbeat", {}); S.me = r.me; showNudge(r.nudge); } catch (_) { /* 次の心拍で */ }
  }
  function showNudge(n) {
    const bar = $("nudgeBar");
    let later = 0; try { later = +localStorage.getItem("dt.nudge.later." + (n && n.at)) || 0; } catch (_) { /* 覚えられなくても出す */ }
    if (!n || Date.now() < later) { bar.hidden = true; return; }
    bar.innerHTML = `<b aria-hidden="true">⚠</b><span>管理者${n.by ? `（${esc(n.by)}）` : ""}から更新のお願い: この PC を版 <b>${esc(n.version)}</b> にしてください（${esc(md(n.at))}）</span>
      <button type="button" class="btn2" id="nudgeGo">↻ 開き直して更新</button><button type="button" class="lnk" id="nudgeLater">あとで（4 時間）</button>`;
    bar.hidden = false;
    $("nudgeLater").onclick = () => { try { localStorage.setItem("dt.nudge.later." + n.at, String(Date.now() + LATER_MS)); } catch (_) { /* 今だけ畳む */ } bar.hidden = true; };
    $("nudgeGo").onclick = async () => {
      say("新しい版を取り込んで、開き直しています…");
      try { await post("/__desktop/update/check"); await post("/__desktop/update/apply"); }
      catch (e) { say(`更新できません: ${e.message}（設定の「この PC」で確かめてください）`, true); }
    };
  }
  beat();
  setInterval(beat, 20000);
  window.addEventListener("pagehide", () => {
    try { navigator.sendBeacon("/api/heartbeat", new Blob([JSON.stringify({ left: true })], { type: "application/json" })); } catch (_) { /* 心拍が途切れれば使っていない扱いになる */ }
  });

  // ---------------------------------------------------------------- 使用状況（管理者の見出しのボタンの数・配布の頁の台数）
  async function loadFleet() {
    try { S.fleet = await call("/api/presence"); } catch (e) { S.fleet = { error: e.message, rows: [], counts: {} }; }
    const by = {};
    for (const r of S.fleet.rows || []) by[r.version] = (by[r.version] || 0) + 1;
    window.dtUsers = by;   // 配布の表の「使っている PC」
    const n = (S.fleet.counts || {}).behind || 0, dev = S.me && S.me.developer;
    for (const b of [$("setBadge"), $("setTabN")]) { b.hidden = !dev || !n; b.textContent = n; b.title = `要更新の PC ${n} 台`; }
    return S.fleet;
  }
  const verTag = (r, latest) => (r.developer ? tag("dev", "対象外（開発者）") : r.behind ? tag("behind", `要更新 → ${esc(latest)}`) : latest && r.version === latest ? tag("ok", "最新") : "");
  const state = (r) => `<span class="set-dot${r.active ? "" : " off"}"></span>${r.active ? "使用中" : "使っていない"}`;
  const nudged = (r) => (r.nudged && r.behind ? `<div>${tag("on", `お願い済み ${esc(md(r.nudged.at).slice(6))}`, `${r.nudged.by} が ${md(r.nudged.at)} に促しました`)}</div>` : "");

  function kpi(f) {
    const c = f.counts || {};
    return `<div class="set-kpi"><div><span>最新版${f.distributed ? "（配っている版）" : ""}</span><b>${esc(f.latest || "—")}</b></div>
      <div><span>いま使っている PC</span><b>${c.active || 0} 台</b></div><div class="warn"><span>要更新の PC</span><b>${c.behind || 0} 台</b></div>
      <div><span>記録のある PC</span><b>${c.all || 0} 台</b></div></div>`;
  }
  function fleetPage() {
    const f = S.fleet;
    if (f.error) return `<div class="set-err">使用状況を読めません: ${esc(f.error)}</div>`;
    const c = f.counts || {}, me = S.me || {};
    const rows = (f.rows || []).filter((r) => S.filter === "all" || (S.filter === "active" ? r.active : r.behind));
    const filt = [["all", `すべて ${c.all || 0}`], ["active", `使用中 ${c.active || 0}`], ["behind", `要更新 ${c.behind || 0}`]]
      .map(([k, t]) => `<button type="button" data-filter="${k}" class="${S.filter === k ? "on" : ""}">${t}</button>`).join("");
    return kpi(f) + `<div class="set-filter">${filt}</div>
      <table class="set-t"><thead><tr><th>状態</th><th>PC 名</th><th>ログイン名</th><th>版</th><th>最後</th><th class="n">回数・時間</th><th></th></tr></thead><tbody>${rows.map((r) => `
        <tr class="${r.behind ? "behind" : ""}"><td>${state(r)}</td><td>${esc(r.pc)}${r.key === me.key ? " " + tag("me", "あなた") : ""}</td><td>${esc(r.login)}</td>
        <td><span class="set-v">${esc(r.version)}</span> ${verTag(r, f.latest)}${nudged(r)}</td><td>${r.active ? "いま" : ago(r.agoSec)}</td>
        <td class="n">${r.sessions || 0} 回・${hours(r.totalSec || 0)}</td>
        <td class="set-ops"><button type="button" class="primary${r.behind ? "" : " gap"}" data-set="nudge" data-key="${esc(r.key)}"${r.behind ? "" : ' tabindex="-1"'}>${r.nudged ? "再度促す" : "更新を促す"}</button><button type="button" data-set="hist" data-key="${esc(r.key)}">履歴</button><button type="button" class="${r.active ? "gap" : ""}" data-set="forget" data-key="${esc(r.key)}"${r.active ? ' tabindex="-1"' : ""}>記録を消す</button></td></tr>`).join("")
      || '<tr><td colspan="7" class="sub">まだ記録がありません（各 PC が開くと、ここに出ます）</td></tr>'}</tbody></table>
      <div class="sub">使用中 = ${f.ttlSec || 75} 秒以内に心拍があった PC。要更新 = 配る版（決まっていなければ最新版）と違う版の PC（開発者は対象外）。</div>`;
  }
  function spread(f) {
    const by = {};
    for (const r of f.rows || []) by[r.version] = (by[r.version] || 0) + 1;
    const vs = Object.entries(by).sort((a, b) => (a[0] < b[0] ? 1 : -1));
    const kind = (v) => (v === f.latest ? ["ok", "配っている版"] : (f.rows || []).some((r) => r.version === v && r.behind) ? ["behind", "要更新"] : ["dev", "開発者が試している版"]);
    return `<div class="set-card"><div class="set-sec">版の行き渡り <span class="sub">記録のある ${(f.rows || []).length} 台</span></div>
      <div class="set-bar">${vs.map(([v, n]) => `<i class="${kind(v)[0]}" style="flex:${n}" title="${esc(v)}・${n} 台"></i>`).join("")}</div>
      <div class="set-legend">${vs.map(([v, n]) => `<span><i class="${kind(v)[0]}"></i><span class="set-v">${esc(v)}</span> ${n} 台 <span class="sub">${kind(v)[1]}</span></span>`).join("")}</div></div>`;
  }
  function behindCard(f) {
    const b = (f.rows || []).filter((r) => r.behind);
    return `<div class="set-card"><div class="set-sec">更新を促す相手 ${tag("behind", `${b.length} 台`)}</div>${b.length ? `<table class="set-t">${b.map((r) => `
      <tr class="behind"><td>${esc(r.pc)}</td><td>${esc(r.login)}</td><td><span class="set-v">${esc(r.version)}</span>${nudged(r)}</td><td>${state(r)}・${r.active ? "いま" : ago(r.agoSec)}</td>
      <td class="set-ops"><button type="button" class="primary" data-set="nudge" data-key="${esc(r.key)}">${r.nudged ? "再度促す" : "更新を促す"}</button></td></tr>`).join("")}</table>`
      : '<div class="sub">要更新の PC はありません</div>'}</div>`;
  }

  // ---------------------------------------------------------------- 使用の履歴
  async function histPage() {
    let h;
    try { h = await call("/api/presence/sessions?limit=2000"); } catch (e) { return `<div class="set-err">使用の履歴を読めません: ${esc(e.message)}</div>`; }
    const all = h.sessions || [];
    // 日ごとの使った PC の数（直近 14 日）
    const days = [...Array(14)].map((_, i) => { const d = new Date(Date.now() - (13 - i) * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
    const per = days.map((d) => new Set(all.filter((s) => (s.start || "").startsWith(d)).map((s) => s.key)).size);
    const top = Math.max(1, ...per);
    const pcs = [...new Map(all.map((s) => [s.key, s.pc])).entries()];
    const rows = all.filter((s) => !S.pcFilter || s.key === S.pcFilter).slice(0, 300);
    return `<div class="set-card"><div class="set-sec">日ごとの使った PC の数 <span class="sub">直近 14 日</span></div>
        <div class="set-days">${per.map((n, i) => `<div title="${days[i]}: ${n} 台"><span>${n || ""}</span><i style="height:${Math.round((n / top) * 64)}px"></i><em>${+days[i].slice(8)}</em></div>`).join("")}</div></div>
      <div class="set-filter wrap"><button type="button" data-pcf="" class="${S.pcFilter ? "" : "on"}">すべての PC</button>${pcs.map(([k, pc]) => `<button type="button" data-pcf="${esc(k)}" class="${S.pcFilter === k ? "on" : ""}">${esc(pc)}</button>`).join("")}</div>
      <table class="set-t"><thead><tr><th>日付・時刻</th><th class="n">使った時間</th><th>PC 名</th><th>ログイン名</th><th>版</th></tr></thead><tbody>${rows.map((s) => `
        <tr><td>${esc(md(s.start))}</td><td class="n">${hm(s.sec || 0)}</td><td>${esc(s.pc)}</td><td>${esc(s.login)}</td><td><span class="set-v">${esc(s.version)}</span>${s.changedFrom ? " " + tag("on", `更新 ${esc(s.changedFrom)} → ${esc(s.version)}`) : ""}</td></tr>`).join("")
        || '<tr><td colspan="5" class="sub">まだ記録がありません</td></tr>'}</tbody></table>
      <div class="set-card set-row"><b>記録を残す日数</b><input id="setDays" type="number" min="30" max="3650" value="${h.historyDays || 365}"> 日
        <button type="button" data-set="days">保存</button><span class="spacer"></span><button type="button" data-set="prune">古い記録を今すぐ整理</button></div>`;
  }

  // ---------------------------------------------------------------- この PC
  async function pcPage() {
    const me = S.me || (await call("/api/me").then((r) => r.me).catch(() => ({})));
    const [desk, ini, mine] = await Promise.all([
      window.dtDesk ? window.dtDesk.pcRows().catch(() => null) : null,
      window.dtPins ? window.dtPins.card() : "",
      me.shared ? call("/api/presence/sessions?limit=8&key=" + encodeURIComponent(me.key)).catch(() => null) : null]);
    const latest = S.fleet && S.fleet.latest;
    const verOk = latest && me.version === latest ? " " + tag("ok", "最新") : latest && !me.developer && me.version !== latest ? " " + tag("behind", `要更新 → ${esc(latest)}`) : "";
    // 1 分に満たない使い始め（開いてすぐ閉じた）は、表を埋めないように除く。合計は使用状況の要約から
    const ss = ((mine && mine.sessions) || []).filter((s) => (s.sec || 0) >= 60);
    const sum = ((S.fleet && S.fleet.rows) || []).find((r) => r.key === me.key);
    return `<div class="set-two"><div class="set-col">
        <div class="set-card"><div class="set-sec">この PC</div><dl class="set-dl">
          <dt>ログイン名</dt><dd>${esc(me.login || "—")}</dd><dt>PC 名</dt><dd>${esc(me.pc || "—")} <span class="sub">（${esc(me.pcSource || "—")} から）</span></dd>
          <dt>権限</dt><dd>${me.developer ? tag("dev", "開発者") + ' <span class="sub">版を置く・配る・使用状況の記録を消す・表示の初期値を決める</span>' : "利用者"}</dd>
          <dt>この PC の版</dt><dd><span class="set-v">${esc(me.version || "")}</span>${verOk}</dd></dl>${desk ? desk.html : ""}</div>
        <div class="set-card" id="setIni">${ini}</div></div>
      <div class="set-col"><div class="set-card"><div class="set-sec">この PC の使用の記録${sum ? ` <span class="sub">${sum.sessions || 0} 回・${hours(sum.totalSec || 0)}</span>` : ""}</div>${!me.shared ? '<div class="sub">配布の置き場に届かないので、記録していません</div>' : ss.length ? `<table class="set-t"><thead><tr><th>日付・時刻</th><th class="n">使った時間</th><th>版</th></tr></thead><tbody>${ss.map((s) => `
          <tr><td>${esc(md(s.start))}</td><td class="n">${hm(s.sec || 0)}</td><td><span class="set-v">${esc(s.version)}</span>${s.changedFrom ? " " + tag("on", `更新 ${esc(s.changedFrom)} → ${esc(s.version)}`) : ""}</td></tr>`).join("")}</tbody></table>` : '<div class="sub">まだ記録がありません</div>'}</div></div></div>`;
  }

  // ---------------------------------------------------------------- 窓
  async function show(page) {
    S.page = page;
    const dev = S.me && S.me.developer;
    if (!dev && page !== "pc") page = S.page = "pc";
    document.querySelectorAll("#setTabs [data-page]").forEach((b) => b.classList.toggle("on", b.dataset.page === page));
    document.querySelectorAll("#setBody > section").forEach((s) => { s.hidden = s.dataset.page !== page; });
    $("setBody").scrollTop = 0;
    if (dev) await loadFleet();
    if (page === "pc") $("setPc").innerHTML = await pcPage();
    if (page === "fleet") $("setFleet").innerHTML = fleetPage();
    if (page === "history") $("setHist").innerHTML = await histPage();
    if (page === "release") {
      $("relMore").innerHTML = S.fleet && !S.fleet.error ? `<div class="set-two eq">${spread(S.fleet)}${behindCard(S.fleet)}</div>` : "";
      if (window.dtDesk) await window.dtDesk.release();
    }
  }
  async function open(page) {
    if (!S.me) await beat();
    const me = S.me || {};
    $("setMe").innerHTML = me.version ? tag("me", `${esc(me.login || "（ログイン名なし）")} @ ${esc(me.pc || "（PC 名なし）")}・版 ${esc(me.version)}`) + (me.developer ? tag("dev", "開発者") : "") : "";
    document.querySelectorAll("#setTabs [data-dev]").forEach((x) => { x.hidden = !me.developer; });
    $("setModal").hidden = false;
    await show(page || "pc");
    $("setClose").focus();
  }
  window.dtSettings = { open, show };
  const close = () => { $("setModal").hidden = true; };
  $("btnSettings").addEventListener("click", () => open("pc"));
  $("setClose").addEventListener("click", close);
  $("setModal").addEventListener("mousedown", (e) => { if (e.target === $("setModal")) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("setModal").hidden && $("pinWarn").hidden) { close(); e.stopPropagation(); } }, true);
  $("setTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-page]"); if (b) show(b.dataset.page); });
  if (window.dtDesk) window.dtDesk.onChange = () => { if (!$("setModal").hidden && S.page !== "release") show(S.page); };

  $("setBody").addEventListener("click", async (e) => {
    const f = e.target.closest("[data-filter]");
    if (f) { S.filter = f.dataset.filter; $("setFleet").innerHTML = fleetPage(); return; }
    const pf = e.target.closest("[data-pcf]");
    if (pf) { S.pcFilter = pf.dataset.pcf; $("setHist").innerHTML = await histPage(); return; }
    const ini = e.target.closest("[data-ini]");
    if (ini && window.dtPins) { const h = await window.dtPins.act(ini.dataset.ini); if (h && $("setIni")) $("setIni").innerHTML = h; return; }
    const b = e.target.closest("[data-set]"); if (!b || b.classList.contains("gap")) return;
    const key = b.dataset.key, row = (S.fleet && S.fleet.rows || []).find((r) => r.key === key) || {};
    try {
      if (b.dataset.set === "nudge") {
        await post("/api/presence/nudge", { key });
        say(`${row.pc}（${row.login}）に更新のお願いを出しました（その PC の画面に帯が出ます）`);
      } else if (b.dataset.set === "hist") {
        S.pcFilter = key; return show("history");
      } else if (b.dataset.set === "forget") {
        if (!confirm(`${row.pc}（${row.login}）の使用の記録を消しますか？（元に戻せません）`)) return;
        await post("/api/presence/forget", { key });
        say(`${row.pc} の記録を消しました`);
      } else if (b.dataset.set === "days") {
        const r = await post("/api/presence/retention", { days: +$("setDays").value });
        say(`記録を ${r.historyDays} 日残します`);
      } else if (b.dataset.set === "prune") {
        const r = await post("/api/presence/prune", {});
        say(`古い記録を ${r.removed} 件消しました`);
      }
      await show(S.page);
    } catch (er) { say(er.message, true); }
  });

  // 管理者は、開いたときと 5 分ごとに要更新の数を見出しのボタンに出す
  setTimeout(async () => { if (!S.me) await beat(); if (S.me && S.me.developer) { loadFleet(); setInterval(loadFleet, 300000); } }, 1500);
})();
