// 画像の仕分けの案（2 回目）。1 回目（2026-11-02-classify.mjs）は 6 案とも 80 点に届かなかった（1 位 F 68.0）:
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-11-02-classify-2.mjs
//
// 1 回目の採点で低かった所（2026-11-02-classify.json）:
//  - グループの色（赤・青）が、カードの枠・MAP の表面（赤）・裏面（青）と同じ → 表裏・分類の色（赤・青・緑・橙）と重ならない色（紫・緑青）＋記号（◆・▼）
//  - 右の欄の先頭に箱を入れると、1280 で MAP が押し出される → 置き場を変える（左の欄の木の下の空き・帯・MAP の下）
//  - 見本（実線）と当てはまる（点線）の札が見分けられない → 見本は塗りの札「見本」、当てはまるは枠の札「当てはまる」と字で分ける
//  - 割り出した条件が画面で読めない（C）・見出しの説明が 2 段に折れる（A・F）→ 条件は 1 行の字で見せる・説明は短く
//  - 盤面（B）・専用の窓（E）は、フィルタや一覧（ドラッグの元）が消える → 一覧の上にドロップ先を置く
//  - F のグループ順の並びに、CAB 順へ戻す切り替えが無い → 並びの切り替え（CAB 順・グループ順）を出す
// 効いた所（持ち越す）: 右の欄のグループの行（ドロップ先・見本 n/3・条件）（A）・グループ順の見出し（F）
// 案の方向: 置き場（左の欄の空き・帯・MAP の下・右の欄の先頭）× 並び（CAB 順のまま・切り替え）

const G = [
  { n: "黒点", m: "◆", c: "#7b3fb0", ex: 3, hit: 7, rule: "濃さ 99〜119 ・ 面積 2.2〜2.6 mm²" },
  { n: "スジ", m: "▼", c: "#0f766e", ex: 2, hit: 0, rule: "見本をあと 1 枚（3 枚で条件を割り出します）" },
];
const EX = [0, 2, 6], HIT = [3, 9, 10, 11], SJ = [4, 7];
// カードの札: 見本は塗りの札「◆ 黒点 見本」、当てはまるは枠の札「◆ 黒点」
const TAGS = ["script", `window.__tags = () => { const G = ${JSON.stringify(G)}; const ths = [...document.querySelectorAll("#grid .th")].slice(0, 12);
  ths.forEach((t, i) => { if (t.querySelector(".ctag")) return; let g = null, ex = false;
    if (${JSON.stringify(EX)}.includes(i)) { g = G[0]; ex = true; } else if (${JSON.stringify(HIT)}.includes(i)) g = G[0]; else if (${JSON.stringify(SJ)}.includes(i)) { g = G[1]; ex = true; }
    if (!g) return;
    t.insertAdjacentHTML("afterbegin", ex ? '<span class="ctag ex" style="background:' + g.c + ';border-color:' + g.c + '">' + g.m + ' ' + g.n + ' 見本</span>' : '<span class="ctag" style="color:' + g.c + ';border-color:' + g.c + '">' + g.m + ' ' + g.n + '</span>'); }); };`];
const AFTER = `return (async () => { await new Promise((r) => setTimeout(r, 300)); if (window.__tags) window.__tags(); if (window.__more) await window.__more(); })()`;
export const STATES = { lot: AFTER };

const BASE = `.ctag{position:absolute;z-index:2;right:8px;top:4px;font:700 12px/1.5 system-ui,sans-serif;background:#fff;border:1.5px solid;border-radius:4px;padding:0 6px;pointer-events:none;white-space:nowrap}
.ctag.ex{color:#fff}
.cls-g{display:grid;grid-template-columns:auto 1fr auto;gap:2px 8px;align-items:center;border:1px solid var(--line);border-radius:6px;padding:6px 8px;background:var(--pane)}
.cls-g .mk{font-size:14px;width:18px;text-align:center}.cls-g b{font-size:13px}.cls-g .n{font:12px Consolas,monospace;color:var(--sub);text-align:right;white-space:nowrap}
.cls-g .rule{grid-column:1/-1;font-size:12px;color:var(--sub);line-height:1.4}
.cls-g.drop{outline:2px dashed #7b3fb0;outline-offset:2px;background:#f4eefa}
.cls-add{font-size:12px;color:var(--acc);border:1px dashed var(--acc);border-radius:6px;padding:4px 8px;text-align:center}
.cls-head{display:flex;gap:6px;align-items:baseline;font-weight:700;font-size:13px;color:var(--acc)}.cls-head .sub{font-weight:400;font-size:12px;white-space:nowrap}
.cls-list{display:flex;flex-direction:column;gap:6px}`;
const rows = (drop) => G.map((g, i) => `<div class="cls-g${drop && i === 1 ? " drop" : ""}"><span class="mk" style="color:${g.c}">${g.m}</span><b>${g.n}</b><span class="n">見本 ${g.ex}/3 ・ ${g.hit} 枚</span><span class="rule">${g.rule}</span></div>`).join("");
const LEFT = (extra = "") => ["insert", `<div class="cls-left" style="padding:8px 10px;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:6px"><div class="cls-head">仕分け <span class="sub">カードをグループへドラッグ</span>${extra}</div><div class="cls-list">${rows(true)}</div><div class="cls-add">＋ グループを作る</div></div>`, "beforebegin", "#treePane .nb-leg"];
const SORT = `<span class="seg" style="margin-left:auto;font-weight:400"><button type="button">CAB 順</button><button type="button" class="on">グループ順</button></span>`;
const GROUPED = ["script", `window.__more = async () => { const g = document.getElementById("grid"); const ths = [...g.querySelectorAll(".th")];
  g.querySelectorAll(".cabsep,.ph").forEach((x) => x.remove());
  const by = (re) => ths.filter((t) => re.test(t.querySelector(".ctag")?.textContent || "")); const bk = by(/黒点/), sj = by(/スジ/), rest = ths.filter((t) => !t.querySelector(".ctag"));
  g.innerHTML = ""; const head = (m, c, n, s) => g.insertAdjacentHTML("beforeend", '<div class="cabsep"><span><span style="color:' + c + '">' + m + '</span> ' + n + '</span><span class="st done">' + s + '</span></div>');
  head("◆", "#7b3fb0", "黒点", bk.length + "枚"); bk.forEach((t) => g.append(t)); head("▼", "#0f766e", "スジ", "見本 2/3"); sj.forEach((t) => g.append(t)); head("", "", "未分類", rest.length + "枚"); rest.forEach((t) => g.append(t)); };`];

export const PROPOSALS = [
  {
    key: "G", name: "左の欄の木の下の空きに「仕分け」（グループの行＝ドロップ先・記号と色・見本 n/3・条件 1 行）。右の欄（画像情報・MAP）は変えない。カードの札は 見本＝塗り・当てはまる＝枠",
    css: BASE, ops: [TAGS, LEFT()],
  },
  {
    key: "H", name: "フィルタの帯の下に「仕分け」の帯 1 行（グループの札＝ドロップ先・押すと絞る）。選んだグループの条件を帯の右に字で。フィルタの帯は今のまま",
    css: BASE + `.cls-bar{display:flex;gap:8px;align-items:center;padding:4px 12px;border-bottom:1px solid var(--line);background:var(--pane);white-space:nowrap;overflow:hidden}
.cls-bar .lab{font-size:13px;font-weight:700;color:var(--sub)}.cls-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:14px;padding:1px 10px;font-size:13px;background:var(--pane)}
.cls-chip.on{border-color:#7b3fb0;background:#f4eefa}.cls-chip.drop{outline:2px dashed #0f766e}.cls-bar .rule{font-size:12px;color:var(--sub);overflow:hidden;text-overflow:ellipsis;min-width:0}`,
    ops: [TAGS, ["insert", `<div class="cls-bar"><span class="lab">仕分け</span>${G.map((g, i) => `<span class="cls-chip${i === 0 ? " on" : ""}${i === 1 ? " drop" : ""}"><span style="color:${g.c}">${g.m}</span>${g.n} <b>${g.hit ? g.hit + " 枚" : "見本 " + g.ex + "/3"}</b></span>`).join("")}<span class="cls-chip" style="border-style:dashed;color:var(--acc)">＋</span><span class="rule">◆ 黒点: ${G[0].rule}</span></div>`, "afterend", "#fBar"]],
  },
  {
    key: "I", name: "G＋一覧の並びの切り替え（CAB 順・グループ順）。グループ順では CAB の見出しと同じ形の見出し「◆ 黒点 7 枚」「▼ スジ 見本 2/3」「未分類」",
    css: BASE, ops: [TAGS, LEFT(), ["insert", `<span class="seg" title="一覧の並び"><button type="button">CAB 順</button><button type="button" class="on">グループ順</button></span>`, "beforebegin", "#sizerWrap"], GROUPED],
  },
  {
    key: "J", name: "右の欄の MAP の下（ロット情報の上）に「仕分け」の箱（折りたためる）。画像情報と MAP は今の位置のまま。カードの札",
    css: BASE + `#infoPane .cls-box .cls-list{padding:6px}`,
    ops: [TAGS, ["script", `const boxes = document.querySelectorAll("#infoPane > details.box"); boxes[1].insertAdjacentHTML("afterend", '<details class="box cls-box" open><summary>仕分け <span class="sub">カードをグループへドラッグ</span></summary><div class="cls-list">${rows(true).replace(/'/g, "\\'")}<div class="cls-add">＋ グループを作る</div></div></details>');`]],
  },
  {
    key: "K", name: "A の直し（持ち越し）: 右の欄の先頭に「仕分け」の箱（説明は短く 1 行）・色と記号・札は 見本＝塗り・当てはまる＝枠",
    css: BASE + `#infoPane .cls-box .cls-list{padding:6px}`,
    ops: [TAGS, ["insert", `<details class="box cls-box" open><summary>仕分け <span class="sub">カードをドラッグ</span></summary><div class="cls-list">${rows(true)}<div class="cls-add">＋ グループを作る</div></div></details>`, "afterbegin", "#infoPane"]],
  },
];
