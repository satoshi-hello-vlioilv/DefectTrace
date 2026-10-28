// 版・更新・ショートカット・配布（窓〈desktop/src/main.rs・updater.rs〉の /__desktop/… に尋ねる）。配布の頁とこの PC の版・ショートカットは
// 設定の窓（settings-view.js）の中に描く（window.dtDesk）。
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
  // ショートカットを作る（帯の「作る」と、いつでも作り直せる所〈配布の窓〉の両方が使う）。→ {ok, msg}
  // 窓の答えが 15 秒で返らなくても、作れたかを置き場に尋ね直して決める（答えが返らないと、押しても何も起きないように見える）
  async function makeShortcut() {
    const links = () => call("/__desktop/install").then((s) => (s.shortcut && s.shortcut.links) || []).catch(() => []);
    let r = null, err = null;
    try { r = await Promise.race([post("/__desktop/shortcut"), new Promise((done) => setTimeout(() => done(null), 15000))]); } catch (e) { err = e; }
    if (!r) {
      const got = await links();
      if (got.length) return { ok: true, msg: `ショートカットを作りました（${got.length} か所: デスクトップ・スタート）` };
      return { ok: false, msg: err ? `作れませんでした。${err.message}` : "作れたか確かめられません（窓から 15 秒答えがありません）。デスクトップを見て、無ければもう一度押してください" };
    }
    const made = r.made || [], probs = r.problems || [];
    if (made.length && !probs.length) return { ok: true, msg: `ショートカットを作りました（${made.length} か所: デスクトップ・スタート）` };
    return { ok: false, msg: `${made.length ? `${made.length} か所だけ作れました。` : "作れませんでした。"}${probs.join(" / ") || "作る場所がありません"}` };
  }
  window.dtMakeShortcut = makeShortcut;
  // 帯: 押した所で結果が分かるように、作れたら帯の中に「✓ 作りました」を数秒出してから畳む。作れなかったら帯を残して理由を出す（もう一度押せる）
  $("scMake").addEventListener("click", async () => {
    const b = $("scMake"), why = $("scWhy"), bar = $("scBar");
    b.disabled = true; b.textContent = "作っています…"; why.hidden = true; $("scAsk").hidden = false;
    const r = await makeShortcut();
    b.disabled = false;
    why.textContent = r.ok ? `✓ ${r.msg}` : r.msg; why.title = r.msg; why.hidden = false; $("scAsk").hidden = true;   // 問いの字を畳み、結果を全部見せる
    why.classList.toggle("ok", r.ok);
    say(r.ok ? r.msg : `ショートカット: ${r.msg}`, !r.ok);
    if (r.ok) {
      b.hidden = true; $("scDecline").hidden = true;
      setTimeout(() => { bar.hidden = true; }, 5000);
    } else b.textContent = "もう一度作る";
  });
  $("scDecline").addEventListener("click", async () => {
    try { await post("/__desktop/shortcut/decline"); $("scBar").hidden = true; } catch (e) { say(e.message, true); }
  });

  // ---------------------------------------------------------------- 配布の頁（設定の窓の中）
  // 形は 3 回の案出しと別のエージェントの採点で決めた（R12: program/tools/proposals/2026-10-27-release-modal*。設定の窓に移すとき N:
  //   2026-10-28-settings*）: 頭の段（置き場・読み直す・ZIP から版を置く）→ 手順の 1 行 → 版の表（状態を文で・使っている PC の台数・
  //   操作は行だけ・配っている版を大きく緑で）→ 新しい PC へ（配る入口のアドレスとコピー）→（settings-view.js が足す）行き渡り・促す相手。
  //   この PC の版・更新・ショートカットは、設定の「この PC」の頁（pcRows）
  let lastView = null, pcState = { upd: {}, inst: {} };
  async function loadRelease(cached) {
    const body = $("relBody");
    if (!cached || !lastView) body.innerHTML = '<div class="rl-note">置き場をたどっています…</div>';
    const [view, upd, inst] = await Promise.all([
      call("/__desktop/release" + (cached ? "?cached=1" : "")).catch((e) => ({ reachable: false, why: e.message })),
      call("/__desktop/update").catch(() => ({})), call("/__desktop/install").catch(() => ({}))]);
    lastView = view; pcState = { upd, inst };
    renderRelease(lastView);
    if (cached && lastView.cached) loadRelease(false);   // 覚えた答えを先に出し、裏で確かめ直す
  }
  // この PC（版・更新・ショートカット）。ショートカットは、ここからいつでも何度でも作れる
  function thisPc() {
    const { upd, inst } = pcState;
    const cur = upd.current || "", ready = upd.state === "ready" && upd.ready;
    const links = (inst.shortcut && inst.shortcut.links) || [];
    const sc = !inst.installed ? "この PC へ写していない形で開いているので、作れません（共有・BOX の exe から一度開くと作れます）"
      : links.length ? "デスクトップ・スタートにあります（消したときも、ここから何度でも作れます）"
      : "ありません（作ると、次から共有の exe を探さずに開けます）";
    return `<div class="rl-me">
      <div class="rl-row"><span class="grow">版 <b>${esc(cur)}</b>${ready ? ` → <b>${esc(upd.ready)}</b> を取り込み済み（開き直すと入れ替わります）` : "（いまの版）"}</span>
        ${ready ? '<button type="button" class="rl-btn amber" data-act="apply">↻ 開き直して更新</button>' : ""}</div>
      <div class="rl-row"><span class="grow">ショートカット: <b>${links.length ? "デスクトップ・スタートにあります" : ""}</b>${links.length ? "（消したときも、ここから何度でも作れます）" : sc}</span>
        ${inst.installed ? '<button type="button" class="rl-btn" data-act="shortcut">⌂ ショートカットを作る</button>' : ""}</div>
      <div class="rl-row" id="relScMsg" hidden></div></div>`;
  }
  function renderRelease(v) {
    const me = v.me || {};
    const head = `<div class="rl-head"><span class="rl-note">置き場</span><span class="rl-path" title="${esc(v.found || "")}">${esc(v.appFolder || v.found || v.folder || "")}</span>
      <button type="button" class="rl-btn" data-act="check" title="置き場を読み直して、版の一覧を新しくする">↻ 読み直す</button>
      ${me.canRelease ? '<button type="button" class="rl-btn bold" data-act="place">＋ ZIP から版を置く…</button>' : ""}</div>`;
    if (!v.reachable) {
      $("relBody").innerHTML = `<div class="rl">${head}<div class="rl-err">置き場（${esc(v.folder || "")}）に届きません: ${esc(v.why || "")}</div>
        <div class="rl-note">BOX が同期されているかを確かめてください。版は置き場の下の DefectTrace\\versions\\&lt;版&gt; に置きます。
          別の場所にするときは、この PC の作業場所の config.json の update_source に書きます（空なら既定の置き場。「;」で区切って複数）。</div></div>`;
      return;
    }
    const dist = v.distributed || {};
    const rows = (v.versions || []).map((r) => {
      const on = r.version === dist.version, mine = r.version === me.current;
      const st = on ? `<span class="tag dist">配っている</span> 各 PC はこの版になります${dist.recommended ? ` <span class="tag rec">推奨: ${esc(dist.recommended.note || "")}</span>` : ""}`
        : mine ? '<span class="tag me">この PC</span> この PC が使っている版'
        : '<span class="tag new">置いただけ</span> まだどの PC にも配っていません';
      const acts = !me.canRelease ? "" : on
        ? `<button type="button" class="rl-btn" data-act="rec" data-v="${esc(r.version)}">${dist.recommended ? "推奨を外す" : "推奨の札を付ける"}</button>`
        : `<button type="button" class="rl-btn ${dist.version && newer(r.version, dist.version) ? "pri" : ""}" data-act="dist" data-v="${esc(r.version)}">${dist.version && !newer(r.version, dist.version) ? "この版に戻す" : "この版を配る"}</button><button type="button" class="rl-btn del" data-act="del" data-v="${esc(r.version)}">消す</button>`;
      const n = (window.dtUsers || {})[r.version];
      return `<tr class="${on ? "on" : ""}"><td class="v"><b>${esc(r.version)}</b><span>${esc(when(r.placedAt))} ${esc(r.placedBy || "")}${r.bytes ? " ・ " + mb(r.bytes) : ""}</span></td><td class="s">${st}</td><td class="n">${n ? n + " 台" : "—"}</td><td class="acts">${acts}</td></tr>`;
    }).join("") || '<tr><td colspan="4" class="rl-note">このアプリの版はまだ置いてありません。右上の「＋ ZIP から版を置く…」で置きます</td></tr>';
    $("relBody").innerHTML = `<div class="rl">${head}
      <div class="rl-prog" id="relProg" hidden><div></div></div>
      <div class="rl-flow"><span><span class="n">1</span>ZIP から置く</span><span class="ar">→</span><span><span class="n">2</span>展開した exe で試す</span><span class="ar">→</span>
        <span><span class="n">3</span>「この版を配る」</span><span class="rl-note">（各 PC は起動時と 30 分ごとに取り込む）</span></div>
      <table class="rl-t"><thead><tr><th>版・置いた日時</th><th>状態</th><th class="n">使っている PC</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      ${v.entry && v.entry.path ? `<div class="rl-sec"><h4>新しい PC へ</h4><div class="rl-row"><span class="rl-path grow">${esc(v.entry.path)}</span><button type="button" class="rl-btn" data-act="copy">アドレスをコピー</button></div>
        <div class="rl-note">このアドレスの exe を開くだけで、配っている版がその PC に入ります</div></div>` : ""}
      ${(v.problems || []).length ? `<div class="rl-err">読めない物: ${esc(v.problems.join(" / "))}</div>` : ""}
      ${me.canRelease ? "" : '<div class="rl-note">版を置く・配るのは、config.json の release_users に名前がある人だけです。</div>'}
      ${v.cached ? `<div class="rl-note">${esc(when(v.checkedAt))} にたどった結果を出しています（確かめ直しています）</div>` : ""}</div>`;
  }
  // 版の新しさ（数で比べる: 4.10.0 は 4.9.0 より新しい）
  function newer(a, b) {
    const p = (x) => String(x).split(".").map(Number);
    const [x, y] = [p(a), p(b)];
    for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    return false;
  }
  async function act(kind, version) {
    try {
      if (kind === "check") { await post("/__desktop/update/check"); return loadRelease(false); }
      if (kind === "shortcut") {
        const m = $("relScMsg"); m.hidden = false; m.className = "rl-row rl-note"; m.textContent = "作っています…";
        const r = await window.dtMakeShortcut();
        m.className = "rl-row " + (r.ok ? "rl-ok" : "rl-err"); m.textContent = r.ok ? `✓ ${r.msg}` : r.msg;
        if (r.ok) { $("scBar").hidden = true; const inst = await call("/__desktop/install").catch(() => null); if (inst) pcState.inst = inst; }
        say(r.ok ? r.msg : `ショートカット: ${r.msg}`, !r.ok);   // 結果は押した所（頁は描き直さない: 描き直すと結果の文が消える）
        return;
      }
      if (kind === "copy") {
        const t = (lastView.entry || {}).path || "";
        try { await navigator.clipboard.writeText(t); say("配る入口のアドレスをコピーしました"); } catch (_) { say(`コピーできません。手で写してください: ${t}`, true); }
        return;
      }
      if (kind === "apply") { say("開き直して入れ替えています…"); await post("/__desktop/update/apply"); return; }
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
      if (window.dtDesk.onChange) window.dtDesk.onChange();
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
  // 配布の頁とこの PC の頁のボタン（data-act）
  for (const id of ["relBody", "setPc"]) $(id).addEventListener("click", (e) => { const b = e.target.closest("button[data-act]"); if (b) act(b.dataset.act, b.dataset.v); });
  window.dtDesk = {
    /** 配布の頁を描く（覚えた答えを先に出し、裏で確かめ直す） */
    release: () => loadRelease(true),
    /** この PC の版・更新・ショートカットの行（HTML） */
    async pcRows() {
      const [upd, inst] = await Promise.all([call("/__desktop/update").catch(() => ({})), call("/__desktop/install").catch(() => ({}))]);
      pcState = { upd, inst };
      return { html: thisPc(), upd, inst };
    },
    /** 配っている版（配布の答えを覚えていれば） */
    distributed: () => ((lastView || {}).distributed || {}).version || null,
    onChange: null,
  };

  showVersion();
  showShortcut();
  setInterval(showVersion, 60000);   // 裏の取り込み（30 分ごと）が済んだら見出しに出す
})();
