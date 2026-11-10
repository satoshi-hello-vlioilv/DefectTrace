// 表示項目の数値の書式を変える画面の案（2 回目）:
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-11-10-num-format-2.mjs
//
// 1 回目（2026-11-10-num-format.json。1 位 B 70.4 点・C 70.3・A 69.5）の指摘を、どの案にも入れた:
//  - 入口を見えるようにする。ただし全部の札に「自動」を出さない（書式を決めた札だけに印。帯が混まない・折り返さない）
//  - 入口をすべての数の項目にそろえる（画像表示・サマリの札〈板厚・欠陥数も〉、右の画像情報・ロット情報の行）
//  - 日時の hh:mm と同じ色・形の印（黄の輪郭・Consolas の小さな札）。日時の書式も同じ入口・同じ小窓で選ぶ
//  - 自由な書式の入力は必ず残す。各形に見本の値を付ける
// 案の方向: A2（札・行に指を乗せると「書式」ボタン）・B2（右クリック＋指を乗せると出る ⋯）・C2（項目の設定の小窓。縦の一覧）・
//   新 G（数そのものを押す）・新 H（置き場の見出しの ⚙ でまとめて直す）・新 I（札の末尾の ▾ にまとめる。hh:mm も ▾ に）
// 撮り方: 「指を乗せた」状態は、画像表示の DS幅入後 の札と、右の画像情報の DS幅入後 の行に .hov を付けて見せる。

const PRESETS = [["", "自動（今まで）"], ["0", "0"], ["0.0", "0.0"], ["0.00", "0.00"], ["0.000", "0.000"], ["#,##0", "#,##0"], ["#,##0.00", "#,##0.00"], ["0.0%", "0.0%"]];
const SAMPLE = { "": "974.39", "0": "974", "0.0": "974.4", "0.00": "974.39", "0.000": "974.390", "#,##0": "974", "#,##0.00": "974.39", "0.0%": "97439.0%" };
const CSS = `.nf-pop{position:fixed;z-index:70;background:var(--pane);border:1px solid #9fb3cc;border-radius:8px;box-shadow:0 10px 28px rgba(15,30,60,.22);padding:10px 12px;font-size:13px;display:flex;flex-direction:column;gap:8px}
.nf-pop h5{margin:0;font-size:13px;color:var(--acc)}.nf-pop .sub{font-size:12px}
.nf-list{display:grid;grid-template-columns:auto 1fr;gap:2px 14px;align-items:center}
.nf-list button{text-align:left;font:13px Consolas,monospace;padding:2px 8px;border-color:transparent;background:none}.nf-list button.on{background:var(--accbg);border-color:#b7cbe6;color:var(--acc);font-weight:700}
.nf-list span{font:13px Consolas,monospace;color:var(--sub);text-align:right}
.nf-free{display:flex;gap:6px;align-items:center;white-space:nowrap}.nf-free input{width:110px;font-family:Consolas,monospace}
.nf-prev{display:flex;justify-content:space-between;border-top:1px solid var(--line2);padding-top:6px}.nf-prev b{font:600 14px Consolas,monospace}
/* 書式を決めた印（日時の hh:mm と同じ形・色） */
.nf-mark{border:1px solid #ecd9a8;background:var(--pane);border-radius:8px;padding:0 5px;font:11px Consolas,monospace;color:var(--pin);line-height:14px;margin-left:3px}
.chip.hov{border-color:var(--acc);box-shadow:0 0 0 2px var(--accbg)}tr.hov td{background:var(--accbg)}tr.hov td.b{width:auto;white-space:nowrap}`;
const list = (cur) => `<div class="nf-list">${PRESETS.map(([k, l]) => `<button type="button"${k === cur ? ' class="on"' : ""}>${l}</button><span>${SAMPLE[k]}</span>`).join("")}</div>`;
const free = `<div class="nf-free"><span class="sub">自由に</span><input type="text" value="0.0" aria-label="書式"><span class="sub">例 0.000・#,##0</span></div>`;
const prev = `<div class="nf-prev"><span class="sub">974.390 →</span><b>974.4</b></div>`;
const POP = (title = "DS幅入後(mm) の書式") => `<div class="nf-pop" style="width:300px"><h5>${title}</h5>${list("0.0")}${free}${prev}</div>`;
// 置く: 札（画像表示の DS幅入後）の下、または画像情報の行の左
const AT_CHIP = (html, dx = 0) => `const c = document.querySelector('.cardzone [data-pid="d_c_dst"]'); const r = c.getBoundingClientRect();
  document.body.insertAdjacentHTML("beforeend", ${JSON.stringify(html)}); const p = document.body.lastElementChild; const b = p.getBoundingClientRect();
  p.style.left = Math.max(8, Math.min(innerWidth - b.width - 8, r.left + ${dx})) + "px"; p.style.top = Math.max(8, Math.min(innerHeight - b.height - 8, r.bottom + 6)) + "px";`;
const ROW = `[...document.querySelectorAll("#imgInfo tr.pinned")].find((t) => t.textContent.includes("DS幅入後"))`;
const AT_ROW = (html) => `const t = ${ROW}; const r = t.getBoundingClientRect();
  document.body.insertAdjacentHTML("beforeend", ${JSON.stringify(html)}); const p = document.body.lastElementChild; const b = p.getBoundingClientRect();
  p.style.left = Math.max(8, r.left - b.width - 8) + "px"; p.style.top = Math.max(8, Math.min(innerHeight - b.height - 8, r.top - 20)) + "px";`;
// 共通: 書式を決めた札・行（DS幅入後 = 0.0）にだけ印。指を乗せた札・行に .hov
const MARK = `const c = document.querySelector('.cardzone [data-pid="d_c_dst"]'); c.classList.add("hov"); c.querySelector(".cl").insertAdjacentHTML("afterend", '<span class="nf-mark" title="書式">0.0</span>');
  const t = ${ROW}; if (t) { t.classList.add("hov"); t.querySelector("td.k").insertAdjacentHTML("beforeend", ' <span class="nf-mark">0.0</span>'); }`;

export const STATES = {};
export const PROPOSALS = [
  {
    key: "A2", name: "A2: 札・行に指を乗せると「書式」ボタン（押すと書式の小窓）。書式を決めた物にだけ hh:mm と同じ形の印",
    css: CSS + `.nf-btn{border:1px solid #ecd9a8;background:var(--pane);color:var(--pin);border-radius:8px;padding:0 6px;font-size:11.5px;line-height:15px;margin-left:3px}`,
    ops: [["script", MARK], ["script", `document.querySelector('.cardzone [data-pid="d_c_dst"] .nf-mark').insertAdjacentHTML("afterend", '<button type="button" class="nf-btn">書式</button>');
      ${ROW}.querySelector("td.b").insertAdjacentHTML("afterbegin", '<button type="button" class="nf-btn">書式</button>');`], ["script", AT_CHIP(POP())]],
  },
  {
    key: "B2", name: "B2: 右クリックのメニュー＋指を乗せると出る「⋯」でも同じメニュー（名前を変える／書式 ▸／外す）",
    css: CSS + `.nf-more{border:none;background:none;color:var(--acc);font-weight:700;padding:0 4px}
.nf-menu{padding:4px 0;gap:0;min-width:200px}.nf-menu>button{text-align:left;border:none;background:none;padding:5px 14px;border-radius:0}.nf-menu>button.on{background:var(--accbg)}.nf-menu hr{border:none;border-top:1px solid var(--line2);margin:3px 0}`,
    ops: [["script", MARK], ["script", `document.querySelector('.cardzone [data-pid="d_c_dst"] .x').insertAdjacentHTML("beforebegin", '<button type="button" class="nf-more" title="名前・書式・外す">⋯</button>');`],
      ["script", AT_CHIP(`<div class="nf-pop nf-menu"><button type="button">名前を変える…</button><button type="button" class="on">書式 ▸</button><hr><button type="button">外す</button></div>`)],
      ["script", `const m = document.querySelector(".nf-menu"); const r = m.getBoundingClientRect(); document.body.insertAdjacentHTML("beforeend", ${JSON.stringify(`<div class="nf-pop" style="width:280px">${list("0.0")}${free}</div>`)});
        const s = document.body.lastElementChild; const b = s.getBoundingClientRect(); s.style.left = Math.min(innerWidth - b.width - 8, r.right - 4) + "px"; s.style.top = Math.max(8, Math.min(innerHeight - b.height - 8, r.top + 30)) + "px";`]],
  },
  {
    key: "C2", name: "C2: 「項目の設定」の小窓（名前・書式〈見本付きの縦の一覧〉・自由に・見本）。指を乗せると出る ✎ とダブルクリックで開く",
    css: CSS + `.nf-edit{border:none;background:none;color:var(--acc);padding:0 3px;font-size:12px}
.nf-dlg{width:340px;padding:14px 16px;gap:10px}.nf-dlg label{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--sub)}.nf-dlg input[type=text]{font-size:14px}.nf-act{display:flex;justify-content:flex-end;gap:8px}`,
    ops: [["script", MARK], ["script", `document.querySelector('.cardzone [data-pid="d_c_dst"] .x').insertAdjacentHTML("beforebegin", '<button type="button" class="nf-edit" title="名前と書式">✎</button>');`],
      ["script", AT_CHIP(`<div class="nf-pop nf-dlg"><h5>項目の設定 <span class="sub">画像表示・DETECT_INFO</span></h5><label>名前<input type="text" value="DS幅入後(mm)"></label>
        <label>数値の書式${list("0.0")}</label>${free}${prev}<div class="nf-act"><button type="button">取り消す</button><button type="button" class="primary">決める</button></div></div>`, -60)]],
  },
  {
    key: "G", name: "G（新）: 数そのものを押すと、その場で書式の小窓（数に指を乗せると点線の下線と「書式」の吹き出し）",
    css: CSS + `.nf-num{text-decoration:underline dotted var(--acc);text-underline-offset:3px;cursor:pointer}.nf-tip{position:fixed;z-index:69;background:#1f2a3a;color:#fff;font-size:12px;border-radius:4px;padding:2px 8px}`,
    ops: [["script", MARK], ["script", `const t = ${ROW}; const v = t.children[1]; v.innerHTML = '<span class="nf-num">' + v.textContent + '</span>';
      const card = document.querySelector("#grid .th.sel .cm .rw:nth-child(5) b") || document.querySelector("#grid .th .cm b"); if (card) card.classList.add("nf-num");`],
      ["script", AT_ROW(POP("DS幅入後(mm) の書式（押した数）"))]],
  },
  {
    key: "H", name: "H（新）: 置き場の見出し（画像表示・サマリ・画像情報…）の「⚙」で、その置き場の項目の名前と書式を表でまとめて直す",
    css: CSS + `.nf-gear{border:1px solid #b7cbe6;background:var(--pane);color:var(--acc);border-radius:5px;padding:0 6px;font-size:12px;margin-left:4px}
.nf-tbl{border-collapse:collapse;font-size:13px}.nf-tbl td,.nf-tbl th{padding:4px 8px;border-bottom:1px solid var(--line2);text-align:left;white-space:nowrap}.nf-tbl th{font-size:12px;color:var(--sub)}
.nf-tbl td.n{font-family:Consolas,monospace;text-align:right}.nf-tbl select{font-family:Consolas,monospace;font-size:12.5px}`,
    ops: [["script", MARK], ["script", `document.querySelector(".cardzone .dzl").insertAdjacentHTML("afterend", '<button type="button" class="nf-gear" title="この置き場の項目の名前と書式">⚙</button>');`],
      ["script", AT_CHIP(`<div class="nf-pop" style="width:460px"><h5>画像表示の項目 <span class="sub">名前と書式（見本は選んだ画像の値）</span></h5><table class="nf-tbl"><tr><th>名前</th><th>書式</th><th style="text-align:right">見本</th></tr>${
        [["幅方向OS～(mm)", "自動", "675.61"], ["DS元幅(mm)", "自動", "974.39"], ["OS幅入後(mm)", "自動", "675.61"], ["DS幅入後(mm)", "0.0", "974.4"], ["長さ方向(m)", "自動", "2100.78"], ["面積(mm²)", "自動", "2.40"], ["面積率", "0.0%", "39.9%"], ["平均レベル暗", "0", "62"]]
          .map((r) => `<tr><td>${r[0]}</td><td><select><option>${r[1]}</option></select></td><td class="n">${r[2]}</td></tr>`).join("")}</table>${free}<div style="display:flex;justify-content:flex-end;gap:8px"><button type="button">閉じる</button></div></div>`, -200)]],
  },
  {
    key: "I", name: "I（新）: どの札・行にも末尾の「▾」（名前・書式・外す。日時の hh:mm も ▾ の中へ）。書式を決めた物は印",
    css: CSS + `.nf-dd{border:none;background:none;color:var(--sub);padding:0 2px;font-size:11px}
.nf-menu{padding:4px 0;gap:0;width:300px}.nf-menu>button{text-align:left;border:none;background:none;padding:5px 14px;border-radius:0}.nf-menu hr{border:none;border-top:1px solid var(--line2);margin:3px 0}.nf-menu .nf-in{padding:4px 12px;display:flex;flex-direction:column;gap:6px}`,
    ops: [["script", MARK], ["script", `document.querySelectorAll(".cardzone .chip .x, #summary .chip .x").forEach((x) => x.insertAdjacentHTML("beforebegin", '<button type="button" class="nf-dd" title="名前・書式・外す">▾</button>'));
      document.querySelectorAll("#summary .chip .fm").forEach((f) => f.remove());`],
      ["script", AT_CHIP(`<div class="nf-pop nf-menu"><button type="button">名前を変える…</button><hr><div class="nf-in"><b style="font-size:12px;color:var(--sub)">書式</b>${list("0.0")}${free}</div><hr><button type="button">外す</button></div>`)]],
  },
];
for (const p of PROPOSALS) p.ops = [...p.ops, ["script", `document.body.dataset.proposal = ${JSON.stringify(p.key)};`]];
STATES.edit = "";
