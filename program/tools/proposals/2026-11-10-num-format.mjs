// 表示項目の数値の書式を、利用者が自由に変える画面の案（1 回目）:
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-11-10-num-format.mjs
//
// 利用者の依頼: 「検査長は数値の書式変更ができるように（数値関係はすべて自由に書式変更できるようにしたい）」
// 書式の規則は裏で作った（desktop/src/numfmt.rs。表計算と同じ書式の文字: 0・0.00・#,##0・0.0%。空なら今までの表示）。
// 今の画面（撮った画像で見えたこと）:
//  - 書式を変えられるのは日時だけ（札の中の「hh:mm」のボタンを押すたびに 2 つの形を切り替える）
//  - 名前を変えるのはダブルクリックで出る入力の小窓（prompt）。何ができるかは札の title にしか書いていない
//  - 数の項目（画像表示・画像情報・サマリ・ロット情報・一覧）は、書式を変える入口がどこにも無い
// 案の方向: 置き場（A: 札の中のボタン・B: 右クリックのメニュー・D: データ項目の窓・F: 設定の窓）・
//   流れ（C: 項目の設定の小窓に名前と書式をまとめる）・見せ方（E: 小数の桁を −／＋ でその場で）

const PRESETS = [["", "自動（今まで）"], ["0", "0"], ["0.0", "0.0"], ["0.00", "0.00"], ["0.000", "0.000"], ["#,##0", "#,##0"], ["#,##0.00", "#,##0.00"], ["0.0%", "0.0%"]];
// 見本の値（画像表示の DS幅入後: 974.390）
const SAMPLE = { "": "974.39", "0": "974", "0.0": "974.4", "0.00": "974.39", "0.000": "974.390", "#,##0": "974", "#,##0.00": "974.39", "0.0%": "97439.0%" };
const CSS = `.nf-pop{position:fixed;z-index:70;background:var(--pane);border:1px solid #9fb3cc;border-radius:8px;box-shadow:0 10px 28px rgba(15,30,60,.22);padding:10px 12px;font-size:13px;display:flex;flex-direction:column;gap:8px}
.nf-pop h5{margin:0;font-size:13px;color:var(--acc)}.nf-pop .sub{font-size:12px}
.nf-list{display:grid;grid-template-columns:auto 1fr;gap:2px 14px;align-items:center}
.nf-list button{text-align:left;font:13px Consolas,monospace;padding:2px 8px;border-color:transparent;background:none}.nf-list button.on{background:var(--accbg);border-color:#b7cbe6;color:var(--acc);font-weight:700}
.nf-list span{font:13px Consolas,monospace;color:var(--sub);text-align:right}
.nf-free{display:flex;gap:6px;align-items:center;white-space:nowrap}.nf-free input{width:110px;font-family:Consolas,monospace}
.nf-prev{display:flex;justify-content:space-between;border-top:1px solid var(--line2);padding-top:6px}.nf-prev b{font:600 14px Consolas,monospace}
.nf-badge{font:11px Consolas,monospace;color:var(--acc);background:var(--accbg);border:1px solid #b7cbe6;border-radius:8px;padding:0 5px;margin-left:2px}`;
const list = (cur) => `<div class="nf-list">${PRESETS.map(([k, l]) => `<button type="button"${k === cur ? ' class="on"' : ""}>${l}</button><span>${SAMPLE[k]}</span>`).join("")}</div>`;
const free = `<div class="nf-free"><span class="sub">自由に</span><input type="text" value="0.0" aria-label="書式"><span class="sub">例 0.000・#,##0</span></div>`;
const prev = `<div class="nf-prev"><span class="sub">974.390 →</span><b>974.4</b></div>`;
// 札（画像表示の DS幅入後）の近くに置く
const NEAR = (html, dx = 0, dy = 6) => `const c = document.querySelector('.cardzone [data-pid="d_c_dst"]'); const r = c.getBoundingClientRect();
  document.body.insertAdjacentHTML("beforeend", ${JSON.stringify(html)}); const p = document.body.lastElementChild; const b = p.getBoundingClientRect();
  p.style.left = Math.max(8, Math.min(innerWidth - b.width - 8, r.left + ${dx})) + "px"; p.style.top = Math.min(innerHeight - b.height - 8, r.bottom + ${dy}) + "px";`;
// 数の札に今の書式の札を付ける（A・E 以外は、書式を決めた札だけに付ける）
const BADGE = (all) => `document.querySelectorAll('.cardzone .chip, #summary .chip').forEach((c) => { const l = c.querySelector('.cl'); if (!l) return;
  const num = /mm|\\(m\\)|面積|率|レベル|長|幅/.test(l.textContent); if (!num) return; const set = c.dataset.pid === "d_c_dst";
  if (${all} || set) l.insertAdjacentHTML("afterend", '<span class="nf-badge">' + (set ? "0.0" : "自動") + '</span>'); });`;

export const STATES = {};
export const PROPOSALS = [
  {
    key: "A", name: "A: 数の札に書式のボタン（日時の hh:mm と同じ形）・押すと書式を選ぶ小窓（よく使う形・自由に・見本）",
    css: CSS + `.nf-badge{cursor:pointer}`,
    ops: [["script", BADGE(true)], ["script", NEAR(`<div class="nf-pop" style="width:300px"><h5>DS幅入後(mm) の書式</h5>${list("0.0")}${free}${prev}</div>`)]],
  },
  {
    key: "B", name: "B: 札・行の右クリックのメニュー（名前を変える／書式 ▸ よく使う形・自由に…／外す）",
    css: CSS + `.nf-menu{padding:4px 0;gap:0;min-width:200px}.nf-menu>button{text-align:left;border:none;background:none;padding:5px 14px;border-radius:0}.nf-menu>button:hover,.nf-menu>button.on{background:var(--accbg)}
.nf-menu hr{border:none;border-top:1px solid var(--line2);margin:3px 0}.nf-sub{padding:6px 8px}`,
    ops: [["script", BADGE(false)], ["script", NEAR(`<div class="nf-pop nf-menu"><button type="button">名前を変える…</button><button type="button" class="on">書式 ▸</button><hr><button type="button">外す</button></div>`)],
      ["script", `const m = document.querySelector(".nf-menu"); const r = m.getBoundingClientRect(); document.body.insertAdjacentHTML("beforeend", ${JSON.stringify(`<div class="nf-pop nf-sub" style="width:260px">${list("0.0")}<button type="button" style="text-align:left">自由に…</button></div>`)});
        const s = document.body.lastElementChild; s.style.left = (r.right - 4) + "px"; s.style.top = (r.top + 30) + "px";`]],
  },
  {
    key: "C", name: "C: ダブルクリックで「項目の設定」の小窓（名前・書式〈よく使う形の札と自由に〉・見本を 1 つに）",
    css: CSS + `.nf-dlg{width:420px;padding:14px 16px;gap:10px}.nf-dlg label{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--sub)}.nf-dlg input[type=text]{font-size:14px}
.nf-chips{display:flex;flex-wrap:wrap;gap:4px}.nf-chips button{font:12.5px Consolas,monospace;padding:2px 9px;border-radius:12px}.nf-chips button.on{background:var(--acc);color:#fff;border-color:var(--acc)}
.nf-act{display:flex;justify-content:flex-end;gap:8px}`,
    ops: [["script", BADGE(false)], ["script", NEAR(`<div class="nf-pop nf-dlg"><h5>項目の設定 <span class="sub">画像表示・DETECT_INFO</span></h5>
      <label>名前<input type="text" value="DS幅入後(mm)"></label>
      <label>数値の書式<div class="nf-chips">${PRESETS.map(([k, l]) => `<button type="button"${k === "0.0" ? ' class="on"' : ""}>${k === "" ? "自動" : l}</button>`).join("")}</div></label>
      ${free}${prev}<div class="nf-act"><button type="button">取り消す</button><button type="button" class="primary">決める</button></div></div>`, -120)]],
  },
  {
    key: "D", name: "D: データ項目の窓で、表示先の札を押すと、下に「選んだ項目」の名前・書式・見本",
    css: CSS + `.nf-side{border:1px solid #b7cbe6;border-left:3px solid var(--acc);border-radius:6px;margin:0 0 8px;background:#f7faff;padding:10px 12px;display:flex;flex-direction:column;gap:6px;font-size:13px}`,
    ops: [["script", BADGE(false)], ["script", `window.__state = async () => { document.getElementById("btnSources").click(); await new Promise((r) => setTimeout(r, 900)); const side = document.getElementById("srcPlaces");
        side.insertAdjacentHTML("beforebegin", ${JSON.stringify(`<div class="nf-side"><h5 style="margin:0;color:var(--acc)">選んだ項目: DS幅入後(mm)</h5><div class="sub">画像表示・DETECT_INFO の @ds_trim</div>${list("0.0")}${free}${prev}</div>`)}); };`]],
  },
  {
    key: "E", name: "E: 数の札に小数の桁の −／＋ と桁区切り（,）を出し、その場で直す（押すたびに値が変わる）",
    css: CSS + `.nf-step{display:inline-flex;align-items:center;gap:0;margin-left:3px;border:1px solid #b7cbe6;border-radius:8px;overflow:hidden;font:11.5px Consolas,monospace}
.nf-step button{border:none;border-radius:0;padding:0 5px;background:var(--pane);color:var(--acc);font:inherit}.nf-step b{padding:0 4px;color:var(--acc);background:var(--accbg)}`,
    ops: [["script", `document.querySelectorAll('.cardzone .chip, #summary .chip').forEach((c) => { const l = c.querySelector('.cl'); if (!l || !/mm|\\(m\\)|面積|率|レベル|長|幅/.test(l.textContent)) return;
      l.insertAdjacentHTML("afterend", '<span class="nf-step"><button type="button" title="小数を 1 桁減らす">−</button><b>' + (c.dataset.pid === "d_c_dst" ? ".0" : ".00") + '</b><button type="button" title="小数を 1 桁増やす">＋</button><button type="button" title="3 桁ごとに区切る">,</button></span>'); });`]],
  },
  {
    key: "F", name: "F: 設定の窓に「表示の書式」の頁（数の表示項目を表で並べ、書式を選ぶ・見本）",
    css: CSS + `.nf-tbl{border-collapse:collapse;width:100%;font-size:13px}.nf-tbl th,.nf-tbl td{border-bottom:1px solid var(--line2);padding:6px 8px;text-align:left}.nf-tbl th{color:var(--sub);font-size:12px}
.nf-tbl td.n{font-family:Consolas,monospace;text-align:right}.nf-tbl select{font-family:Consolas,monospace}`,
    ops: [["script", BADGE(false)], ["script", `window.__state = async () => { document.getElementById("btnSettings").click(); await new Promise((r) => setTimeout(r, 2500));
      document.querySelectorAll("#setTabs button").forEach((b) => b.classList.remove("on"));
      document.querySelector('#setTabs [data-page="pc"]').insertAdjacentHTML("afterend", '<button type="button" class="on">表示の書式</button>');
      document.querySelectorAll("#setBody>section").forEach((x) => { x.hidden = true; });
      document.getElementById("setBody").insertAdjacentHTML("afterbegin", '<section id="setFmt"></section>');
      const body = document.getElementById("setFmt");
      const rows = [["画像表示", "DS幅入後(mm)", "0.0", "974.4"], ["画像表示", "DS元幅(mm)", "自動", "974.39"], ["画像表示", "面積(mm²)", "自動", "2.40"], ["一覧", "検査長(m)", "0", "3022"], ["サマリ", "検査長(m)", "自動", "3021.50"], ["サマリ", "検査幅(mm)", "#,##0", "1,650"]];
      body.innerHTML = '<div class="set-sec">表示の書式</div><div class="sub">数の表示項目ごとに、出す形を選べます（表計算と同じ書式: 0.00・#,##0・0.0%）。</div><table class="nf-tbl"><tr><th>置き場</th><th>項目</th><th>書式</th><th style="text-align:right">見本</th></tr>' +
        rows.map((r) => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td><select><option>' + r[2] + '</option></select></td><td class="n">' + r[3] + '</td></tr>').join("") + '</table>'; };`]],
  },
];
for (const p of PROPOSALS) p.ops = [...p.ops, ["script", `document.body.dataset.proposal = ${JSON.stringify(p.key)};`]];
STATES.edit = "return (async () => { if (window.__state) await window.__state(); })()";
