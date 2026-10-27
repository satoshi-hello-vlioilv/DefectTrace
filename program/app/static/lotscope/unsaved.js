/* 保存していない変更の見張り（版 3.43.0。利用者の要望 2026-10: マスタに限らず、設定を変えたまま保存せずに閉じる・別の画面へ移る操作に警告を出す）。
   - 下書きを持つ画面は、TPA.unsaved.watch(key, {label, dirty, save, discard, scope}) で名乗る（dirty() が真なら「保存していない」）。
     label … 窓に出す名前（例: 変換表「管理分類」）。dirty … 保存した中身と違えば真。save … 保存する（成功で true）。省けば「保存して進む」を出さない。
     canSave … いま保存できるか（省けば save があれば保存できる）。discard … 保存せずに進むときに下書きを捨てる（省けば何もしない）。scope … どの操作で確かめるか（"master"・"dash"・"list" など。移る・閉じる操作が渡す）
   - 閉じる・移る操作は await TPA.unsaved.leave(scope, "マスタ管理を閉じる") が true のときだけ進む。見張りが無ければ窓を出さずに true
   - 窓（2026-10-unsaved の 3 回目で決めた D3）: 移る先（what）・何が保存されていないか（名前の並び）と、縦に [保存して進む]・[保存せずに進む]・[戻る]。
     どのボタンも右に、押した後に何が起きるかを一言。焦点は「戻る」（いちばん安全。細い藍の輪）。Esc でも戻る
   - アプリを閉じる・読み直す（beforeunload）は、ブラウザの決まりの確かめ（文言は選べない）
   ========================================================================= */
(function () {
  "use strict";
  const watchers = new Map();
  const esc = (s) => TPA.esc(s);
  const isDirty = (w) => { try { return !!w.dirty(); } catch (_) { return false; } };

  /** 保存していない物の並び（scope は scope の名前か見張りの鍵、その並び。"*" ならすべて） */
  function pending(scope = "*") {
    const want = Array.isArray(scope) ? scope : [scope];
    return [...watchers.values()].filter((w) => (want.includes("*") || want.includes(w.scope) || want.includes(w.key)) && isDirty(w));
  }

  /** 「勤務体系のタブへ移る」→「移ります」（ボタンの右の一言）。知らない形は「進みます」 */
  const VERBS = [["移る", "移ります"], ["閉じる", "閉じます"], ["終了する", "終了します"], ["開き直す", "開き直します"], ["足す", "足します"], ["開く", "開きます"]];
  const polite = (what) => (VERBS.find(([v]) => String(what).endsWith(v)) || ["", "進みます"])[1];
  let open = null;     // 出ている窓の約束（同時に 2 つ出さない）
  function ask(list, what) {
    if (open) return open;
    const canSave = list.every((w) => typeof w.save === "function" && (!w.canSave || w.canSave()));
    const box = document.createElement("div");
    box.className = "us-overlay";
    box.innerHTML = `<div class="us-card" role="alertdialog" aria-modal="true" aria-labelledby="usTitle" aria-describedby="usBody">
      <div class="us-head"><span class="us-ico" aria-hidden="true">!</span><h3 id="usTitle">保存していない変更があります</h3></div>
      <div id="usBody" class="us-body"><p>${esc(what)}前に、次の変更をどうしますか。</p><ul>${list.map((w) => `<li>${esc(typeof w.label === "function" ? w.label() : w.label)}</li>`).join("")}</ul></div>
      <p class="us-err" aria-live="polite"></p>
      <div class="us-acts">${canSave ? `<span class="us-act"><button type="button" class="btn-primary" data-us="save">保存して進む</button><small>保存してから${esc(polite(what))}</small></span>` : ""}
        <span class="us-act"><button type="button" class="pv-btn us-discard" data-us="discard">保存せずに進む</button><small>直した所は消えます</small></span>
        <span class="us-act"><button type="button" class="pv-btn" data-us="back">戻る</button><small>この画面に残ります</small></span></div></div>`;
    document.body.appendChild(box);
    const back = box.querySelector('[data-us="back"]');
    back.focus();
    open = new Promise((resolve) => {
      const done = (v) => { box.remove(); document.removeEventListener("keydown", onKey, true); open = null; resolve(v); };
      const onKey = (e) => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(false); }
        if (e.key === "Tab") {          // 焦点を窓の中に留める
          const bs = [...box.querySelectorAll("button:not(:disabled)")], i = bs.indexOf(document.activeElement);
          e.preventDefault(); bs[(i + (e.shiftKey ? bs.length - 1 : 1)) % bs.length].focus();
        }
      };
      document.addEventListener("keydown", onKey, true);
      box.addEventListener("click", async (e) => {
        const b = e.target.closest("[data-us]"); if (!b) return;
        if (b.dataset.us === "back") { done(false); return; }
        if (b.dataset.us === "discard") { list.forEach((w) => { try { w.discard && w.discard(); } catch (_) { /* 捨てられなくても進む */ } }); done(true); return; }
        b.disabled = true; b.textContent = "保存しています…";
        for (const w of list) {
          let ok = false;
          try { ok = (await w.save()) !== false && !isDirty(w); } catch (_) { ok = false; }
          if (!ok) {
            box.querySelector(".us-err").textContent = `「${typeof w.label === "function" ? w.label() : w.label}」を保存できませんでした。画面の知らせを確かめてください。`;
            b.disabled = false; b.textContent = "保存して進む"; return;
          }
        }
        done(true);
      });
    });
    return open;
  }

  /** 中身の字（キーの並びに左右されない。保存した物と下書きを比べるため: {mode, column} と {column, mode} を同じと見る） */
  const key = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((n) => [n, x[n]])) : x));
  window.TPA.unsaved = {
    key,
    same: (a, b) => key(a) === key(b),
    watch(key, spec) { watchers.set(key, { scope: "", ...spec, key }); },
    unwatch(key) { watchers.delete(key); },
    pending,
    /** 移る・閉じる前に確かめる → 進んでよければ true */
    async leave(scope = "*", what = "移る") {
      const list = pending(scope);
      return list.length ? ask(list, what) : true;
    },
  };
  window.addEventListener("beforeunload", (e) => {
    if (window.__tpaQuitting || !pending("*").length) return;
    e.preventDefault(); e.returnValue = "";
  });
})();
