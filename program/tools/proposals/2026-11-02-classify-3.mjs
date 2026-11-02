// 画像の仕分けの案（3 回目）。2 回目（2026-11-02-classify-2.mjs）は 1 位 I 77.7 点で 80 点に届かなかった:
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-11-02-classify-3.mjs
//
// 2 回目の採点で低かった所（2026-11-02-classify.json の rounds[1]）:
//  - I: 1280 で一覧の上の段に「CAB 順｜グループ順」を足したため「列 1 2 3」が 2 段目に落ちた → 並びの切り替えは仕分けの欄の中へ
//  - G・I: 左の欄の木と仕分けの間に約 700px の空白があり、仕分けが欄の底に沈む → 木のすぐ下に寄せる（M は上下に分ける）
//  - ドラッグ中の受けの色が、どのグループでも紫 → そのグループの色
//  - 当てはまる画像が一覧に散らばったまま（G・K）→ グループの行を押すと一覧をそのグループに絞る（H の「押すと絞る」を持ち込む）
//  - I のグループ順の見出しの記号が小さく、CAB の手がかりが無い → 記号を字と同じ大きさに・見出しに CAB の内訳
//  - K: 1280 で MAP が見出しだけになる → O は 1 グループ 1 行の小さな箱
// 効いた所（持ち越す）: 紫・緑青＋記号（◆・▼）の色・見本＝塗りの札／当てはまる＝枠の札・条件 1 行・右の欄を押し出さない（G・I）
// 案の方向: 置き場（木のすぐ下・左の欄を上下に分ける・右の欄の小さな箱）× 当てはまる画像の見せ方（絞る・並べる・見出しに CAB）

const G = [
  { n: "黒点", m: "◆", c: "#7b3fb0", bg: "#f4eefa", ex: 3, hit: 7, rule: "濃さ 99〜119 ・ 面積 2.2〜2.6 mm²" },
  { n: "スジ", m: "▼", c: "#0f766e", bg: "#e6f4f2", ex: 2, hit: 0, rule: "見本をあと 1 枚（3 枚で条件を割り出します）" },
];
const EX = [0, 2, 6], HIT = [3, 9, 10, 11], SJ = [4, 7];
const TAGS = ["script", `window.__tags = () => { const G = ${JSON.stringify(G)}; const ths = [...document.querySelectorAll("#grid .th")].slice(0, 12);
  ths.forEach((t, i) => { if (t.querySelector(".ctag")) return; let g = null, ex = false;
    if (${JSON.stringify(EX)}.includes(i)) { g = G[0]; ex = true; } else if (${JSON.stringify(HIT)}.includes(i)) g = G[0]; else if (${JSON.stringify(SJ)}.includes(i)) { g = G[1]; ex = true; }
    if (!g) return; t.dataset.cg = g.n;
    t.insertAdjacentHTML("afterbegin", ex ? '<span class="ctag ex" style="background:' + g.c + ';border-color:' + g.c + '">' + g.m + ' ' + g.n + ' 見本</span>' : '<span class="ctag" style="color:' + g.c + ';border-color:' + g.c + '">' + g.m + ' ' + g.n + '</span>'); }); };`];
const AFTER = `return (async () => { await new Promise((r) => setTimeout(r, 300)); if (window.__tags) window.__tags(); if (window.__more) await window.__more(); })()`;
export const STATES = { lot: AFTER };

const BASE = `.ctag{position:absolute;z-index:2;right:8px;top:4px;font:700 12px/1.5 system-ui,sans-serif;background:#fff;border:1.5px solid;border-radius:4px;padding:0 6px;pointer-events:none;white-space:nowrap}
.ctag.ex{color:#fff}
.cls-g{display:grid;grid-template-columns:auto 1fr auto;gap:2px 8px;align-items:center;border:1px solid var(--line);border-radius:6px;padding:6px 8px;background:var(--pane);cursor:pointer}
.cls-g .mk{font-size:14px;width:18px;text-align:center}.cls-g b{font-size:13px}.cls-g .n{font:12px Consolas,monospace;color:var(--sub);text-align:right;white-space:nowrap}
.cls-g .rule{grid-column:1/-1;font-size:12px;color:var(--sub);line-height:1.4}
.cls-g.on{border-width:2px}
.cls-add{font-size:12px;color:var(--acc);border:1px dashed var(--acc);border-radius:6px;padding:4px 8px;text-align:center}
.cls-head{display:flex;gap:6px;align-items:baseline;font-weight:700;font-size:13px;color:var(--acc)}.cls-head .sub{font-weight:400;font-size:12px;white-space:nowrap}
.cls-list{display:flex;flex-direction:column;gap:6px}
.cls-sort{display:flex;gap:6px;align-items:center;font-size:12px;color:var(--sub)}.cls-sort .seg button{font-size:12px;padding:1px 8px}
#grid .th.fo{opacity:.25}`;
// グループの行。on: 押して絞っている行・drop: ドラッグ中の受け（そのグループの色）・tool: 行の右に「絞る」
const rows = ({ on = -1, drop = 1, tool = false } = {}) => G.map((g, i) => `<div class="cls-g${i === on ? " on" : ""}" style="${i === on ? `border-color:${g.c};background:${g.bg};` : ""}${i === drop ? `outline:2px dashed ${g.c};outline-offset:2px;background:${g.bg};` : ""}"><span class="mk" style="color:${g.c}">${g.m}</span><b>${g.n}</b><span class="n">見本 ${g.ex}/3 ・ ${g.hit} 枚${tool ? ` <span style="font-family:system-ui;color:var(--acc);border:1px solid var(--line);border-radius:4px;padding:0 5px">${i === on ? "絞り中" : "絞る"}</span>` : ""}</span><span class="rule">${g.rule}</span></div>`).join("");
const SORT = `<div class="cls-sort">一覧の並び <span class="seg"><button type="button">CAB 順</button><button type="button" class="on">グループ順</button></span></div>`;
const SECTION = (opt, extra = "") => `<div class="cls-left" style="padding:8px 10px;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:6px"><div class="cls-head">仕分け <span class="sub">カードをグループへドラッグ・行を押すと絞る</span></div><div class="cls-list">${rows(opt)}</div><div class="cls-add">＋ グループを作る</div>${extra}</div>`;
// 木のすぐ下に置く（木は中身の高さまで・札の見本は欄の底のまま）
const UNDER_TREE = (opt, extra) => [["insert", SECTION(opt, extra), "afterend", "#tree"], ["script", `const t = document.getElementById("tree"); t.style.flex = "0 1 auto"; document.querySelector("#treePane .nb-leg").style.marginTop = "auto";`]];
// 押したグループで一覧を絞る（当てはまらないカードを薄く）
const FILTER = ["script", `window.__more = async () => { const ths = [...document.querySelectorAll("#grid .th")]; let n = 0; ths.forEach((t) => { if (t.dataset.cg !== "黒点") t.classList.add("fo"); else n++; });
  // 絞り込みはフィルタの帯にも出す（同じ「絞る」なので同じ置き場・同じ形。× で外す）
  document.getElementById("fChips").innerHTML = '<span class="f-chip" style="display:inline-flex;gap:6px;align-items:center;border:1.5px solid #7b3fb0;background:#f4eefa;border-radius:12px;padding:0 8px;font-size:13px"><span style="color:#7b3fb0">◆</span>仕分け: 黒点 <b>×</b></span>';
  document.getElementById("fCount").textContent = "7 / 24 枚"; };`];
// グループ順の見出し（CAB の内訳つき）
const GROUPED = (cab) => ["script", `window.__more = async () => { const g = document.getElementById("grid"); const ths = [...g.querySelectorAll(".th")];
  g.querySelectorAll(".cabsep,.ph").forEach((x) => x.remove());
  const bk = ths.filter((t) => t.dataset.cg === "黒点"), sj = ths.filter((t) => t.dataset.cg === "スジ"), rest = ths.filter((t) => !t.dataset.cg);
  const cabs = (ts) => { const m = {}; ts.forEach((t) => { const c = t.dataset.key.split("/")[1]; m[c] = (m[c] || 0) + 1; }); return Object.entries(m).map(([c, n]) => c + ".cab " + n).join("・"); };
  g.innerHTML = ""; const head = (m, c, n, s, ts) => g.insertAdjacentHTML("beforeend", '<div class="cabsep"><span><span style="color:' + c + ';font-size:1em">' + m + '</span> ' + n + '</span><span class="st done">' + s + '</span>' + (${cab} && ts.length ? '<span class="sub" style="margin-left:8px;font-weight:400">' + cabs(ts) + '</span>' : '') + '</div>');
  head("◆", "#7b3fb0", "黒点", bk.length + "枚", bk); bk.forEach((t) => g.append(t)); head("▼", "#0f766e", "スジ", "見本 2/3", sj); sj.forEach((t) => g.append(t)); head("", "", "未分類", rest.length + "枚", rest); rest.forEach((t) => g.append(t)); };`];

export const PROPOSALS = [
  {
    key: "L", name: "木のすぐ下に「仕分け」（空白を詰める）。行を押すと一覧をそのグループに絞る（ほかは薄く）。並びの切り替えは仕分けの欄の中。ドラッグ中の受けはそのグループの色",
    css: BASE, ops: [TAGS, ...UNDER_TREE({ on: 0, drop: 1 }, SORT.replace('<button type="button">CAB 順</button><button type="button" class="on">グループ順</button>', '<button type="button" class="on">CAB 順</button><button type="button">グループ順</button>')), FILTER],
  },
  {
    key: "M", name: "左の欄を上下に分ける（上＝木・下＝仕分け。境目を動かせる）。仕分けは欄の下半分にいつも見える。並びの切り替えと絞りは L と同じ",
    css: BASE + `#treePane{display:flex;flex-direction:column}#tree{flex:1 1 50%;min-height:0;overflow:auto}.cls-split{height:6px;cursor:row-resize;background:var(--line2);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.cls-left{flex:1 1 50%;overflow:auto;min-height:0}`,
    ops: [TAGS, ["insert", `<div class="cls-split" title="ドラッグで高さを変更"></div>${SECTION({ on: 0, drop: 1 }, SORT.replace('<button type="button">CAB 順</button><button type="button" class="on">グループ順</button>', '<button type="button" class="on">CAB 順</button><button type="button">グループ順</button>'))}`, "afterend", "#tree"], FILTER],
  },
  {
    key: "N", name: "L＋グループ順の並び（仕分けの欄で切り替え）: 見出しに記号・枚数・CAB の内訳（「0000.cab 3・0001.cab 4」）。行の右に「絞る」",
    css: BASE, ops: [TAGS, ...UNDER_TREE({ drop: 1, tool: true }, SORT), GROUPED(true)],
  },
  {
    key: "O", name: "右の欄の先頭に 1 グループ 1 行の小さな箱（条件は押さえると出る説明と、選んだ行の下に 1 行）。1280 でも MAP の図が見える。行を押すと絞る",
    css: BASE + `.cls-mini{display:flex;flex-direction:column;gap:4px;padding:6px}.cls-mini .r{display:flex;gap:8px;align-items:center;border:1px solid var(--line);border-radius:6px;padding:3px 8px;font-size:13px}.cls-mini .r .n{margin-left:auto;font:12px Consolas,monospace;color:var(--sub)}.cls-mini .rule{font-size:12px;color:var(--sub);padding:0 8px}`,
    ops: [TAGS, ["insert", `<details class="box cls-box" open><summary>仕分け <span class="sub">カードをドラッグ</span></summary><div class="cls-mini">${G.map((g, i) => `<div class="r" style="${i === 0 ? `border:2px solid ${g.c};background:${g.bg}` : `outline:2px dashed ${g.c};outline-offset:1px`}" title="${g.rule}"><span style="color:${g.c}">${g.m}</span><b>${g.n}</b><span class="n">見本 ${g.ex}/3 ・ ${g.hit} 枚</span></div>${i === 0 ? `<div class="rule">${g.rule}</div>` : ""}`).join("")}<div class="cls-add">＋ グループを作る</div></div></details>`, "afterbegin", "#infoPane"], FILTER],
  },
  {
    key: "I2", name: "I の直し（持ち越し）: 仕分けは左の欄の底のまま、並びの切り替えを小さな「並び ▾」にして一覧の上の段に（1280 で折れない）。グループ順の見出し",
    css: BASE + `.sortmini{font-size:12px;padding:1px 8px;white-space:nowrap}`,
    ops: [TAGS, ["insert", SECTION({ drop: 1 }), "beforebegin", "#treePane .nb-leg"], ["insert", `<button type="button" class="sortmini" title="一覧の並び: グループ順（押すと CAB 順）" aria-label="一覧の並び">⇅</button>`, "beforebegin", "#sizerWrap"], GROUPED(false)],
  },
];
