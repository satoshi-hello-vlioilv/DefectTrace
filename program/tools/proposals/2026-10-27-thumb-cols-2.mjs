// サムネイルの大きさを列の数で決める案（2 回目）。
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-10-27-thumb-cols-2.mjs
//
// 1 回目（2026-10-27-thumb-cols.json）の採点で低かった所と、2 回目での直し方:
//  - どの案にも見切れ −5: 1 枚の下限を 130px に決め打ちしたため、項目名・札・ファイル名の末尾が「…」で切れた
//    → 下限を、カードに今出している項目名・値・札が切れずに入る幅から計算する（項目を増やせば下限も上がる）。入る最大の列の数もそこから決まる
//  - 操作がツールバーの 2 段目に落ちる（1280・1536）→ 操作を表示の切り替え（img・fm_img）のすぐ右に置き、折り返すのは「画像表示」の帯の方にする
//  - A: 8 の次が 10 の飛び番・長い → 2〜9 の続き番（I は入る数だけ）
//  - B・E: 「最大 N」が小さく薄い（−3）→ 12px の本文の色で「/ 最大 N」
//  - E: 設定が 2 か所に分かれ、帯の「24 枚・3 CAB」が下の状態行と重複 → 帯には列の操作だけを置く（E2）
// 新しい案: G（増減を表示の切り替えの右に・最大を同じ字で）・H（選ぶ箱に最大を入れる）・I（入る数だけのボタン）
//
// 状態: lot（5 列）・many（8 列を選んだ後。幅が足りない窓では入る数まで）

export const COMMON = String.raw`
const grid = document.getElementById("grid");
document.getElementById("sizerWrap").style.display = "none";
// カードの中身（項目名＋値・下の札）が切れずに入る幅＝1 枚の下限。画像の幅は 90px より狭くしない
const minCard = () => {
  let need = 0;
  [...grid.querySelectorAll(".th")].slice(0, 60).forEach((th) => {
    th.querySelectorAll(".rw").forEach((r) => { need = Math.max(need, r.children[0].scrollWidth + r.children[1].scrollWidth + 6); });
    const n2 = th.querySelector(".nm2");
    if (n2) need = Math.max(need, [...n2.children].reduce((s, c) => s + c.scrollWidth + 4, 0));
  });
  return Math.max(130, Math.ceil(need) + 2 * 6 + 2 * 2 + 2 * 2);
};
window.__fit = (n) => {
  window.__cols = n;
  const w = grid.clientWidth - 16, gap = 8, max = Math.max(1, Math.floor((w + gap) / (minCard() + gap))), k = Math.min(n, max);
  grid.style.setProperty("--ts", Math.floor((w - gap * (k - 1)) / k) - 40 + "px");
  document.querySelectorAll(".cfeas").forEach((e) => { e.innerHTML = Array.from({ length: Math.min(max, 10) }, (_, i) => '<button type="button" data-cols="' + (i + 1) + '">' + (i + 1) + "</button>").join(""); });
  document.querySelectorAll("[data-cols]").forEach((e) => { e.classList.toggle("on", +e.dataset.cols === k); e.disabled = +e.dataset.cols > max; });
  document.querySelectorAll(".cval").forEach((e) => (e.textContent = k));
  document.querySelectorAll(".cmax").forEach((e) => (e.textContent = max));
  document.querySelectorAll("select.csel option").forEach((e) => { e.disabled = +e.value > max; e.textContent = e.value + " 列" + (+e.value === max ? "（最大）" : ""); });
  document.querySelectorAll("select.csel").forEach((e) => (e.value = k));
  document.querySelectorAll(".stp").forEach((e) => { e.querySelector(".dn").disabled = k <= 1; e.querySelector(".up").disabled = k >= max; });
};
new ResizeObserver(() => window.__fit(window.__cols || 5)).observe(grid);
window.__fit(5);
`;

const BASE = `
.th .rw>span,.th .nm2>*{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cctl{display:flex;align-items:center;gap:6px;color:var(--sub);font-size:12px;white-space:nowrap}
.cctl .seg button{min-width:28px;padding:2px 6px}
.cctl button:disabled{color:#9aa3ad;background:var(--bg);border-style:dashed;cursor:default}
.cctl .stp{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:4px;background:var(--pane)}
.cctl .stp button{border:0;border-radius:0;padding:2px 9px;font-size:14px;line-height:18px}
.cctl .stp b{min-width:42px;text-align:center;font:700 13px "Yu Gothic UI",sans-serif;color:var(--txt);border-left:1px solid var(--line2);border-right:1px solid var(--line2);padding:2px 4px}
.cctl .mx{color:var(--txt);font-size:12px}
`;

// 表示の切り替え（img・fm_img）のすぐ右
const tool = (html) => ["insert", html, "afterend", "#groupTabs"];
const TITLE = "一覧の幅に合わせて、この列の数で並べる（カードの項目が切れずに入る数まで）";

export const STATES = {
  lot: "window.__fit && window.__fit(5)",
  many: "window.__fit && window.__fit(8)",
};

export const PROPOSALS = [
  { key: "now", name: "今（px のつまみ）", css: "", ops: [] },
  {
    key: "A2", name: "列のボタン 2〜9（表示の切り替えの右）",
    css: BASE,
    ops: [["script", COMMON], tool(`<span class="cctl" title="${TITLE}">列 <span class="seg">${[2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-cols="${n}">${n}</button>`).join("")}</span></span>`), ["script", "window.__fit(window.__cols)"]],
  },
  {
    key: "G", name: "増減「− 5 列 ＋ / 最大 7」（表示の切り替えの右）",
    css: BASE,
    ops: [["script", COMMON], tool(`<span class="cctl" title="${TITLE}">列 <span class="stp"><button type="button" class="dn">−</button><b><span class="cval">5</span> 列</b><button type="button" class="up">＋</button></span><span class="mx">/ 最大 <span class="cmax"></span></span></span>`), ["script", "window.__fit(window.__cols)"]],
  },
  {
    key: "H", name: "選ぶ箱「5 列 ▾」（中に最大の印・入らない数は選べない）",
    css: BASE + `.cctl select{font-size:13px;padding:2px 4px;color:var(--txt)}`,
    ops: [["script", COMMON], tool(`<label class="cctl" title="${TITLE}">列 <select class="csel">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<option value="${n}">${n} 列</option>`).join("")}</select></label>`), ["script", "window.__fit(window.__cols)"]],
  },
  {
    key: "I", name: "入る数だけのボタン（1〜最大。窓が狭いと減る）",
    css: BASE,
    ops: [["script", COMMON], tool(`<span class="cctl" title="${TITLE}">列 <span class="seg cfeas"></span></span>`), ["script", "window.__fit(window.__cols)"]],
  },
  {
    key: "E2", name: "一覧の上の帯に列のボタン（帯には操作だけ）",
    css: BASE + `#grid{padding-top:0}.gbar{flex-basis:100%;position:sticky;top:0;z-index:3;display:flex;align-items:center;justify-content:flex-end;gap:8px;background:var(--bg);padding:6px 0 4px;margin-bottom:-4px}`,
    ops: [["script", COMMON], ["insert", `<div class="gbar"><span class="cctl" title="${TITLE}">1 行に並べる数 <span class="seg">${[2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-cols="${n}">${n}</button>`).join("")}</span></span></div>`, "afterbegin", "#grid"], ["script", "window.__fit(window.__cols)"]],
  },
];
