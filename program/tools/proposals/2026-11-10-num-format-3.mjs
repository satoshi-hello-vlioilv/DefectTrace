// 表示項目の数値の書式を変える画面の案（3 回目・最後の回）:
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-11-10-num-format-3.mjs
//
// 2 回目（2026-11-10-num-format.json の rounds[1]。1 位 C2 74.7 点・A2 74.1）の指摘を、どの案にも入れた:
//  - 指を乗せたときのボタン（✎）は札の × の場所に出す（× は指を乗せている間だけ隠れる。札を広げない・名前を隠さない。帯が組み替わらない）
//  - 書式の印は文字を足さず、札・行の左上の小さな点（日時の hh:mm と同じ黄の色）。値は書式どおりに出る。帯の段を増やさない
//  - 形を押したらその場で決まる（決めるの手を減らす。「元に戻す」は残す）。小窓を小さく
//  - サマリの札・ロット情報の行・一覧（左の木の「項目▾」で開く札）の入口も撮る
// 案の方向: C3（項目の設定の小窓: 名前と書式）・A3（書式だけの小窓）・新 K（同じ単位の項目にもまとめて当てる）・
//   新 M（一覧の札からも同じ入口・一覧の行の値が書式どおりに）・新 N（小数の桁・区切り・% を押して組み立てる）
// 撮り方: 指を乗せた状態は .hov（画像表示の DS幅入後 の札）。書式を決めた物: 画像表示の DS幅入後（0.0）・サマリの検査長(m)（#,##0.0）。

const SAMPLE = [["", "自動", "974.39"], ["0", "0", "974"], ["0.0", "0.0", "974.4"], ["0.00", "0.00", "974.39"], ["0.000", "0.000", "974.390"], ["#,##0", "#,##0", "974"], ["#,##0.0", "#,##0.0", "974.4"], ["0.0%", "0.0%", "97439.0%"]];
const CSS = `.nf-pop{position:fixed;z-index:70;background:var(--pane);border:1px solid #9fb3cc;border-radius:8px;box-shadow:0 10px 28px rgba(15,30,60,.22);padding:10px 12px;font-size:13px;display:flex;flex-direction:column;gap:8px}
.nf-pop h5{margin:0;font-size:13px;color:var(--acc);display:flex;align-items:center;gap:6px}.nf-pop .sub{font-size:12px}
.nf-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:3px}
.nf-grid button{display:flex;justify-content:space-between;gap:8px;font:12.5px Consolas,monospace;padding:3px 8px;background:none;border-color:var(--line2)}
.nf-grid button span{color:var(--sub)}.nf-grid button.on{background:var(--accbg);border-color:var(--acc);color:var(--acc);font-weight:700}.nf-grid button.on span{color:var(--acc)}
.nf-free{display:flex;gap:6px;align-items:center;white-space:nowrap}.nf-free input{width:96px;font-family:Consolas,monospace}
.nf-foot{display:flex;align-items:center;gap:8px;border-top:1px solid var(--line2);padding-top:6px}.nf-foot .ok{color:var(--ok);font-size:12px}.nf-foot button{margin-left:auto;font-size:12px;padding:1px 8px}
/* 書式を決めた印: 左上の小さな点（hh:mm と同じ黄）。札を広げない */
.chip,.nf-row td.k{position:relative}.nf-dot::before{content:"";position:absolute;left:2px;top:2px;width:5px;height:5px;border-radius:50%;background:#c9a227}
/* 指を乗せたときのボタン: 札の右端（× の上）に重ねる */
.chip.hov{border-color:var(--acc);box-shadow:0 0 0 2px var(--accbg)}
.chip.hov .x{visibility:hidden}.nf-ov{position:absolute;right:2px;top:50%;transform:translateY(-50%);width:17px;height:17px;border:1px solid var(--acc);background:var(--pane);color:var(--acc);border-radius:50%;padding:0;font-size:11px;line-height:15px;text-align:center}`;
const grid = (cur) => `<div class="nf-grid">${SAMPLE.map(([k, l, v]) => `<button type="button"${k === cur ? ' class="on"' : ""}>${l}<span>${v}</span></button>`).join("")}</div>`;
const free = (v = "0.0") => `<div class="nf-free"><span class="sub">自由に</span><input type="text" value="${v}" aria-label="書式"><span class="sub">例 0.000・#,##0</span></div>`;
const foot = `<div class="nf-foot"><span class="ok">✓ 決めました（974.390 → 974.4）</span><button type="button">元に戻す</button></div>`;
const AT = (sel, html, dx = 0) => `const c = document.querySelector(${JSON.stringify(sel)}); const r = c.getBoundingClientRect();
  document.body.insertAdjacentHTML("beforeend", ${JSON.stringify(html)}); const p = document.body.lastElementChild; const b = p.getBoundingClientRect();
  p.style.left = Math.max(8, Math.min(innerWidth - b.width - 8, r.left + ${dx})) + "px"; p.style.top = Math.max(8, Math.min(innerHeight - b.height - 8, r.bottom + 6)) + "px";`;
const CHIP = '.cardzone [data-pid="d_c_dst"]';
// 共通: 書式を決めた札・行に点、値は書式どおり（サマリの検査長 3,021.5・画像情報の DS幅入後 974.4）。指を乗せた札に重ねたボタン
const COMMON = (btn) => `const c = document.querySelector(${JSON.stringify(CHIP)}); c.classList.add("hov", "nf-dot"); c.insertAdjacentHTML("beforeend", '<button type="button" class="nf-ov">${btn}</button>');
  const s = [...document.querySelectorAll("#summary .chip")].find((x) => x.textContent.includes("検査長")); if (s) { s.classList.add("nf-dot"); s.querySelector(".cv").textContent = "3,021.5"; }
  const t = [...document.querySelectorAll("#imgInfo tr.pinned")].find((x) => x.textContent.includes("DS幅入後")); if (t) { t.classList.add("nf-row"); t.querySelector("td.k").classList.add("nf-dot"); t.children[1].textContent = "974.4"; }`;
const DLG = (extra = "", w = 320) => `<div class="nf-pop" style="width:${w}px"><h5>DS幅入後(mm) <span class="sub">画像表示</span></h5>
  <label class="nf-free"><span class="sub">名前</span><input type="text" value="DS幅入後(mm)" style="width:200px;font-family:inherit"></label>${grid("0.0")}${free()}${extra}${foot}</div>`;

export const STATES = {};
export const PROPOSALS = [
  {
    key: "C3", name: "C3: 項目の設定の小窓（名前・書式。形を押せばその場で決まる）。指を乗せると札の × の場所に ✎ を出す・ダブルクリックでも",
    css: CSS, ops: [["script", COMMON("✎")], ["script", AT(CHIP, DLG())]],
  },
  {
    key: "A3", name: "A3: 書式だけの小窓（形を押せばその場で決まる）。指を乗せると札の × の場所に ✎ を出す（名前はダブルクリックのまま）",
    css: CSS, ops: [["script", COMMON("✎")], ["script", AT(CHIP, `<div class="nf-pop" style="width:300px"><h5>DS幅入後(mm) の書式</h5>${grid("0.0")}${free()}${foot}</div>`)]],
  },
  {
    key: "K", name: "K（新）: C3＋「同じ単位（mm）の項目にもまとめて当てる」（画像表示の mm の 4 項目を 1 度にそろえる）",
    css: CSS + `.nf-same{display:block;line-height:1.5;font-size:12.5px;background:#f7faff;border:1px solid #d6e2f2;border-radius:6px;padding:5px 8px}.nf-same b{color:var(--acc)}`,
    ops: [["script", COMMON("✎")], ["script", AT(CHIP, DLG(`<label class="nf-same"><input type="checkbox" checked> 同じ単位 <b>(mm)</b> の 4 項目にも当てる</label>`, 340))],
      ["script", `document.querySelectorAll('.cardzone .chip').forEach((x) => { if (/\\(mm\\)/.test(x.textContent)) x.classList.add("nf-dot"); });`]],
  },
  {
    key: "M", name: "M（新）: C3＋一覧（左の木の「項目▾」で開く札）からも同じ ✎ と小窓。一覧の行の値も書式どおり（検査長 3022）",
    css: CSS,
    ops: [["script", COMMON("✎")], ["script", `document.getElementById("listCfg").click();`],
      ["script", `const l = [...document.querySelectorAll(".listzone .chip")].find((x) => x.textContent.includes("検査長")); if (l) { l.classList.add("hov", "nf-dot"); l.insertAdjacentHTML("beforeend", '<button type="button" class="nf-ov">✎</button>'); }
        document.querySelector(${JSON.stringify(CHIP)}).classList.remove("hov"); document.querySelector(${JSON.stringify(CHIP)} + " .nf-ov").remove();`],
      ["script", AT('.listzone .chip.hov', `<div class="nf-pop" style="width:320px"><h5>検査長(m) <span class="sub">一覧</span></h5><label class="nf-free"><span class="sub">名前</span><input type="text" value="検査長(m)" style="width:200px;font-family:inherit"></label>
        <div class="nf-grid">${[["", "自動", "3021.50"], ["0", "0", "3022"], ["0.0", "0.0", "3021.5"], ["0.00", "0.00", "3021.50"], ["#,##0", "#,##0", "3,022"], ["#,##0.0", "#,##0.0", "3,021.5"]].map(([k, l, v]) => `<button type="button"${k === "0" ? ' class="on"' : ""}>${l}<span>${v}</span></button>`).join("")}</div>${free("0")}<div class="nf-foot"><span class="ok">✓ 決めました（3021.50 → 3022）</span><button type="button">元に戻す</button></div></div>`)]],
  },
  {
    key: "N", name: "N（新）: 書式を「小数の桁 0〜3」「3 桁区切り」「%」のボタンで組み立てる（押すとその場で決まる。下に書式の文字と見本・自由にも書ける）",
    css: CSS + `.nf-build{display:flex;flex-direction:column;gap:6px}.nf-build>div{display:flex;align-items:center;gap:8px}.nf-build .lab{width:72px;font-size:12px;color:var(--sub)}
.nf-build .seg button{font:12.5px Consolas,monospace;padding:2px 10px}`,
    ops: [["script", COMMON("✎")], ["script", AT(CHIP, `<div class="nf-pop" style="width:330px"><h5>DS幅入後(mm) の書式</h5><div class="nf-build">
      <div><span class="lab">小数の桁</span><span class="seg"><button type="button">自動</button><button type="button">0</button><button type="button" class="on">1</button><button type="button">2</button><button type="button">3</button></span></div>
      <div><span class="lab">3 桁区切り</span><span class="seg"><button type="button" class="on">なし</button><button type="button">1,000</button></span></div>
      <div><span class="lab">百分率</span><span class="seg"><button type="button" class="on">なし</button><button type="button">%</button></span></div></div>${free()}${foot}</div>`)]],
  },
];
for (const p of PROPOSALS) p.ops = [...p.ops, ["script", `document.body.dataset.proposal = ${JSON.stringify(p.key)};`]];
STATES.edit = "";
