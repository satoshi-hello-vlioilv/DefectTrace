// サムネイルの大きさを「列の数」で決める（一覧の幅に合わせて自動で広げる）案（1 回目）。
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-10-27-thumb-cols.mjs
//
// 今の困りごと（今の画面 now/lot-1728.png・lot-1280.png で見えたこと）:
//  - 大きさを px のつまみで決めるので、1728 では 5 列の右に約 80px、1280 では 3 列の右に約 100px の空きが残る（幅に合わない）
//  - つまみに数が出ず、何列並ぶかは並べてみないと分からない（推測させる）
//  - 1280 では「サイズ」のつまみがツールバーの 2 段目に落ちる
// 案の方向（何で解くか）: 操作の型（列のボタン・増減・目盛りのつまみ・選ぶ箱・言葉の段）× 置き場（ツールバーの右・一覧の上の帯）
//
// どの案も仕組みは同じ: 一覧（#grid）の幅から 1 枚の幅を計算して --ts に入れ、ちょうど N 列で幅を埋める（窓の大きさが変わっても追う）。
// 状態: lot（5 列）・many（8 列を選んだ後。幅が足りない窓では入る数まで）

export const COMMON = String.raw`
const grid = document.getElementById("grid");
document.getElementById("sizerWrap").style.display = "none";
// 1 枚の幅は 130px（画像 90px）より狭くしない。入らない列の数は選べないことを操作の側に出す（押せない・灰色）
window.__fit = (n) => {
  window.__cols = n;
  const w = grid.clientWidth - 16, gap = 8, max = Math.max(1, Math.floor((w + gap) / (130 + gap))), k = Math.min(n, max);
  grid.style.setProperty("--ts", Math.floor((w - gap * (k - 1)) / k) - 40 + "px");
  document.querySelectorAll("[data-cols]").forEach((e) => { e.classList.toggle("on", +e.dataset.cols === k); e.disabled = +e.dataset.cols > max; });
  document.querySelectorAll(".cval").forEach((e) => (e.textContent = k));
  document.querySelectorAll(".cmax").forEach((e) => (e.textContent = max));
  document.querySelectorAll("input.crange").forEach((e) => { e.max = max; e.value = k; });
  document.querySelectorAll("select.csel option").forEach((e) => (e.disabled = +e.value > max));
  document.querySelectorAll("select.csel").forEach((e) => (e.value = k));
  document.querySelectorAll(".stp").forEach((e) => { e.firstElementChild.disabled = k <= 1; e.lastElementChild.disabled = k >= max; });
};
new ResizeObserver(() => window.__fit(window.__cols || 5)).observe(grid);
window.__fit(5);
`;

const BASE = `
.th .rw>span,.th .nm2>*{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cctl button:disabled{opacity:.35;cursor:default}
.cctl{display:flex;align-items:center;gap:6px;color:var(--sub);font-size:12px;white-space:nowrap}
.cctl .seg button{min-width:30px;padding:2px 6px}
.cctl .stp{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:4px;background:var(--pane)}
.cctl .stp button{border:0;border-radius:0;padding:2px 9px;font-size:14px;line-height:18px}
.cctl .stp b{min-width:42px;text-align:center;font:700 13px "Yu Gothic UI",sans-serif;color:var(--txt);border-left:1px solid var(--line2);border-right:1px solid var(--line2);padding:2px 4px}
`;

const tool = (html) => ["insert", html, "beforebegin", "#sizerWrap"];
const nums = [2, 3, 4, 5, 6, 7, 8, 10];

export const STATES = {
  lot: "window.__fit && window.__fit(5)",
  many: "window.__fit && window.__fit(8)",
};

export const PROPOSALS = [
  { key: "now", name: "今（px のつまみ）", css: "", ops: [] },
  {
    key: "A", name: "列のボタン（ツールバーの右）",
    css: BASE,
    ops: [
      ["script", COMMON],
      tool(`<span class="cctl" title="一覧の幅に合わせて、この列の数で並べる">列 <span class="seg">${nums.map((n) => `<button type="button" data-cols="${n}">${n}</button>`).join("")}</span></span>`),
      ["script", "window.__fit(window.__cols)"],
    ],
  },
  {
    key: "B", name: "増減（− 5 列 ＋・ツールバーの右）",
    css: BASE,
    ops: [
      ["script", COMMON],
      tool(`<span class="cctl" title="一覧の幅に合わせて、この列の数で並べる（Ctrl＋ホイールでも変わる）">並べる数 <span class="stp"><button type="button">−</button><b><span class="cval">5</span> 列</b><button type="button">＋</button></span><small>最大 <span class="cmax"></span></small></span>`),
      ["script", "window.__fit(window.__cols)"],
    ],
  },
  {
    key: "C", name: "列の目盛りのつまみ（数を出す）",
    css: BASE + `.cctl input.crange{width:150px;padding:0}.cctl .ticks{display:flex;justify-content:space-between;width:150px;font-size:11px;line-height:11px;color:var(--sub)}
.cctl .cr{display:flex;flex-direction:column}.cctl b{font-size:13px;color:var(--txt);min-width:36px}`,
    ops: [
      ["script", COMMON],
      tool(`<span class="cctl" title="一覧の幅に合わせて、この列の数で並べる">列 <span class="cr"><input class="crange" type="range" min="1" max="12" step="1" value="5"><span class="ticks"><span>1</span><span>最大 <span class="cmax"></span></span></span></span><b><span class="cval">5</span> 列</b></span>`),
      ["script", "window.__fit(window.__cols)"],
    ],
  },
  {
    key: "D", name: "選ぶ箱（列数 ▾）",
    css: BASE + `.cctl select{font-size:13px;padding:2px 4px}`,
    ops: [
      ["script", COMMON],
      tool(`<label class="cctl" title="一覧の幅に合わせて、この列の数で並べる">列数 <select class="csel">${[2, 3, 4, 5, 6, 7, 8, 9, 10, 12].map((n) => `<option value="${n}">${n} 列</option>`).join("")}</select></label>`),
      ["script", "window.__fit(window.__cols)"],
    ],
  },
  {
    key: "E", name: "一覧の上の帯に増減（効く所の真上）",
    css: BASE + `#grid{padding-top:0}.gbar{flex-basis:100%;position:sticky;top:0;z-index:3;display:flex;align-items:center;gap:8px;background:var(--bg);padding:6px 0 4px;margin-bottom:-4px;font-size:12px;color:var(--sub)}
.gbar .spacer{flex:1}`,
    ops: [
      ["script", COMMON],
      ["insert", `<div class="gbar"><span>24 枚・3 CAB</span><span class="spacer"></span><span class="cctl" title="一覧の幅に合わせて、この列の数で並べる">1 行に <span class="stp"><button type="button">−</button><b><span class="cval">5</span> 枚</b><button type="button">＋</button></span><small>最大 <span class="cmax"></span></small></span></div>`, "afterbegin", "#grid"],
      ["script", "window.__fit(window.__cols)"],
    ],
  },
  {
    key: "F", name: "大きさの言葉＋列の数（大 3・中 5・小 8・極小 12）",
    css: BASE + `.cctl .seg button small{margin-left:3px;font-size:11px;opacity:.8}`,
    ops: [
      ["script", COMMON],
      tool(`<span class="cctl" title="一覧の幅に合わせて、この列の数で並べる">大きさ <span class="seg">${[["大", 3], ["中", 5], ["小", 8], ["極小", 12]].map(([w, n]) => `<button type="button" data-cols="${n}">${w}<small>${n} 列</small></button>`).join("")}</span></span>`),
      ["script", "window.__fit(window.__cols)"],
    ],
  },
];
