// 版・更新・ショートカット・配布（窓〈desktop/src/main.rs・updater.rs〉の /__desktop/… に尋ねる）。
// 形は 2 回の案出しと別のエージェントの採点で決めた（F2: program/tools/proposals/2026-10-26-update-ui*.）:
//   見出しの右に「版 4.0.0 → ↻ 4.0.1 に更新（主の橙）・推奨の理由（字だけ）」の 1 つの塊・配布の窓（× と Esc で閉じる）・
//   ショートカットが無ければ見出しの下に細い帯（1 回だけ。作る は従の形）
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
  const post = (url, body, raw) => call(url, { method: "POST", headers: raw ? {} : { "Content-Type": "application/json" }, body: raw ? body : JSON.stringify(body || {}) });
  const mb = (n) => (n ? (n / 1e6).toFixed(1) + " MB" : "");
  const when = (s) => (s || "").replace(/^\d{4}-(\d\d)-(\d\d)T(\d\d:\d\d).*/, "$1/$2 $3");

  // ---------------------------------------------------------------- 見出しの版
  async function showVersion() {
    let info, upd;
    try { [info, upd] = await Promise.all([call("/__desktop/info"), call("/__desktop/update")]); } catch (_) { return; }
    const cur = upd.current || info.version || "";
    const dist = upd.distributed || null;
    const rec = dist && dist.recommended && dist.version !== cur ? dist.recommended : null;
    let h = `<span class="vnow" title="この PC の版">版 ${esc(cur)}</span>`;
    if (upd.state === "ready" && upd.ready) {
      const down = upd.direction === "down";
      h += `<span class="vnow">→</span><button type="button" class="vbtn" id="verApply" title="開き直すと ${esc(upd.ready)} に入れ替わります">↻ ${esc(upd.ready)} ${down ? "に戻す" : "に更新"}</button>`;
      if (rec) h += `<span class="vwhy">推奨: ${esc(rec.note || "早めに更新してください")}</span>`;
    } else if (upd.state === "error" && upd.problem) {
      h += `<span class="vwarn" title="${esc(upd.problem)}">更新を確かめられません</span>`;
    }
    $("verBox").innerHTML = h;
    $("verBox").hidden = false;
    $("btnRelease").hidden = !info.installed && !(upd.source || "");
    const ap = $("verApply");
    if (ap) ap.addEventListener("click", async () => {
      ap.disabled = true; say(`${upd.ready} に入れ替えるため、開き直しています…`);
      try { await post("/__desktop/update/apply"); } catch (e) { ap.disabled = false; say(e.message, true); }
    });
  }

  // ---------------------------------------------------------------- ショートカットの帯
  async function showShortcut() {
    let st;
    try { st = await call("/__desktop/install"); } catch (_) { return; }
    $("scBar").hidden = !(st.shortcut && st.shortcut.ask);
  }
  // 作れなかったときは、帯を残して理由を帯の中に出す（押した所で分かる。もう一度押せる）。理由は窓の記録 logs\desktop.log にも残る
  $("scMake").addEventListener("click", async () => {
    const b = $("scMake"), why = $("scWhy");
    b.disabled = true; b.textContent = "作っています…"; why.hidden = true; $("scAsk").hidden = false;
    let msg = "";
    try {
      const r = await post("/__desktop/shortcut");
      const made = r.made || [], probs = r.problems || [];
      if (made.length && !probs.length) {
        $("scBar").hidden = true;
        say(`ショートカットを作りました（${made.length} か所: デスクトップ・スタート）`);
        return;
      }
      msg = `${made.length ? `${made.length} か所だけ作れました。` : "作れませんでした。"}${probs.join(" / ") || "作る場所がありません"}`;
    } catch (e) { msg = `作れませんでした。${e.message}`; }
    finally { b.disabled = false; b.textContent = "作る"; }
    why.textContent = msg; why.title = msg; why.hidden = false; $("scAsk").hidden = true;   // 問いの字を畳み、理由を全部見せる
    b.textContent = "もう一度作る";
    say(`ショートカット: ${msg}`, true);
  });
  $("scDecline").addEventListener("click", async () => {
    try { await post("/__desktop/shortcut/decline"); $("scBar").hidden = true; } catch (e) { say(e.message, true); }
  });

  // ---------------------------------------------------------------- 配布の窓
  let lastView = null;
  async function loadRelease(cached) {
    const body = $("relBody");
    if (!cached || !lastView) body.innerHTML = '<div class="rl-note">置き場をたどっています…</div>';
    try { lastView = await call("/__desktop/release" + (cached ? "?cached=1" : "")); } catch (e) { body.innerHTML = `<div class="rl-err">${esc(e.message)}</div>`; return; }
    renderRelease(lastView);
    if (cached && lastView.cached) loadRelease(false);   // 覚えた答えを先に出し、裏で確かめ直す
  }
  function renderRelease(v) {
    const me = v.me || {};
    if (!v.reachable) {
      $("relBody").innerHTML = `<div class="rl"><div class="rl-err">置き場（${esc(v.folder || "")}）に届きません: ${esc(v.why || "")}</div>
        <div class="rl-note">BOX が同期されているかを確かめてください。版は置き場の下の DefectTrace\\versions\\&lt;版&gt; に置きます。
          別の場所にするときは、この PC の作業場所の config.json の update_source に書きます（空なら既定の置き場。「;」で区切って複数）。</div></div>`;
      return;
    }
    const dist = v.distributed || {};
    const rows = (v.versions || []).map((r) => {
      const on = r.version === dist.version;
      const tags = [on ? '<span class="tag dist">配っている</span>' : "", on && dist.recommended ? `<span class="tag rec">推奨: ${esc(dist.recommended.note || "")}</span>` : "",
        r.version === me.current ? '<span class="tag me">この PC</span>' : "", !on && r.version !== me.current ? '<span class="tag new">置いただけ</span>' : ""].join("");
      const acts = !me.canRelease ? "" : on
        ? `<button type="button" data-act="rec" data-v="${esc(r.version)}">${dist.recommended ? "推奨を外す" : "推奨の札を付ける"}</button>`
        : `<button type="button" data-act="dist" data-v="${esc(r.version)}">この版を配る</button><button type="button" class="del" data-act="del" data-v="${esc(r.version)}">消す</button>`;
      return `<tr class="${on ? "on" : ""}"><td><b>${esc(r.version)}</b></td><td>${esc(when(r.placedAt))} ${esc(r.placedBy || "")}</td><td>${mb(r.bytes)}</td><td>${tags}</td><td>${acts}</td></tr>`;
    }).join("") || '<tr><td colspan="5" class="rl-note">このアプリの版はまだ置いてありません</td></tr>';
    $("relBody").innerHTML = `<div class="rl">
      <div class="rl-head"><span class="rl-src" title="${esc(v.found || "")}">置き場 ${esc(v.appFolder || v.found || "")}</span>
        ${me.canRelease ? '<button type="button" class="primary" data-act="place">ZIP から版を置く…</button>' : ""}<button type="button" data-act="check">確かめる</button></div>
      <div class="rl-prog" id="relProg" hidden><div></div></div>
      <table class="rl-t"><thead><tr><th>版</th><th>置いた日時</th><th>大きさ</th><th>状態</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      ${v.entry && v.entry.path ? `<div class="rl-note">配る入口: ${esc(v.entry.path)}（新しい PC にはこのアドレスだけを渡します）</div>` : ""}
      ${(v.problems || []).length ? `<div class="rl-err">読めない物: ${esc(v.problems.join(" / "))}</div>` : ""}
      ${me.canRelease ? "" : '<div class="rl-note">版を置く・配るのは、config.json の release_users に名前がある人だけです。</div>'}
      ${v.cached ? `<div class="rl-note">${esc(when(v.checkedAt))} にたどった結果を出しています（確かめ直しています）</div>` : ""}</div>`;
  }
  async function act(kind, version) {
    try {
      if (kind === "check") { await post("/__desktop/update/check"); return loadRelease(false); }
      if (kind === "place") return $("relFile").click();
      if (kind === "dist") {
        if (!confirm(`版 ${version} を配りますか？ 各 PC は次に確かめたとき（30 分ごと・開いたとき）にこの版を取り込みます。`)) return;
        const r = await post("/__desktop/release/distribute", { version });
        say(`版 ${version} を配りました${(r.notes || []).length ? "（" + r.notes.join(" / ") + "）" : ""}`);
      }
      if (kind === "del") {
        if (!confirm(`版 ${version} を置き場から消しますか？（元に戻せません）`)) return;
        await post("/__desktop/release/remove", { version });
        say(`版 ${version} を消しました`);
      }
      if (kind === "rec") {
        const on = !(lastView.distributed || {}).recommended;
        const note = on ? prompt("推奨する理由（各 PC の見出しに出ます。120 字まで）", "") : "";
        if (on && note === null) return;
        await post("/__desktop/release/recommend", { version, on, note });
      }
      await loadRelease(false);
      showVersion();
    } catch (e) { say(e.message, true); alert(e.message); }
  }
  $("relFile").addEventListener("change", async () => {
    const f = $("relFile").files[0]; $("relFile").value = "";
    if (!f) return;
    const prog = $("relProg"); if (prog) prog.hidden = false;
    const timer = setInterval(async () => {
      try {
        const p = await call("/__desktop/release/progress");
        if (prog && p.total) prog.firstElementChild.style.width = Math.round((p.done / p.total) * 100) + "%";
      } catch (_) { /* 次で */ }
    }, 300);
    try {
      say(`${f.name} を確かめて置いています…`);
      const r = await post("/__desktop/release/place?name=" + encodeURIComponent(f.name), await f.arrayBuffer(), true);
      say(`版 ${r.version} を置きました（まだ配っていません。試してから「この版を配る」を押してください）`);
    } catch (e) { say(e.message, true); alert(e.message); }
    clearInterval(timer);
    loadRelease(false);
  });
  $("relBody").addEventListener("click", (e) => { const b = e.target.closest("button[data-act]"); if (b) act(b.dataset.act, b.dataset.v); });
  const openRel = () => { $("relModal").hidden = false; loadRelease(true); $("relClose").focus(); };
  const closeRel = () => { $("relModal").hidden = true; };
  $("btnRelease").addEventListener("click", openRel);
  $("relClose").addEventListener("click", closeRel);
  $("relModal").addEventListener("click", (e) => { if (e.target === $("relModal")) closeRel(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("relModal").hidden) { closeRel(); e.stopPropagation(); } }, true);

  showVersion();
  showShortcut();
  setInterval(showVersion, 60000);   // 裏の取り込み（30 分ごと）が済んだら見出しに出す
})();
