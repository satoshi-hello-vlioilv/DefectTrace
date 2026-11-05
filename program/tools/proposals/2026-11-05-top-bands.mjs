// 画像一覧の上の帯（サマリ・切り替え・画像表示・フィルタ）を薄くし、一覧を広くする案（1 回目）:
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-11-05-top-bands.mjs
//
// 今の困りごと（今の画面を撮った画像と、測った数で見えたこと）:
//  - 一覧の上の帯が縦を食う。サマリ 62px（1280 は 3 段で 90px）・切り替えの段 63px（画像表示の札が 2 段に折れる。1280 は 72px）・フィルタ 36px。
//    一覧が中央の高さに占める割合は 1728: 83%・1536: 77%・1280: 65%。全部見えるカードは 1536 で 4 枚・1280 で 3 枚（1 段）
//  - 画像表示の札は、点線の枠の中で 3 個目だけ下の段に落ち（lot-1728・lot-1536）、段の高さが倍になる
//  - カードの下の行（面の札・転写候補の札・ファイル名）が 10px で、ファイル名は薄い灰色（lot-1280 を拡大して確かめた。11px 未満が 1 画面に 50 個余り）
// 案の方向: 減らし方（A: 1 段に収めて溢れは +n）・置き場（B: 切り替えとフィルタを 1 段に・C: サマリを見出しの帯へ）・
//   流れ（D: 一覧を送ると帯が縮む）・見せ方（E: 札の枠を外して密に並べる）・合わせ（F: A と B を合わせて 2 段）

export const STATES = { lot: "" };

// どの案にも当てる: カードの下の行を 11px に・ファイル名を読める濃さに
const CARD = `.th .nm2{font-size:11px;color:#4b5563}.face{font-size:11px}.tbadge{font-size:11px}.dup{font-size:11px}`;

// 札の置き場（.pins）を 1 段に収め、溢れた札を隠して「+n ▾」を出す（押すと全部を下に開く。作るときは大きさが変わるたびに数え直す）
const FOLD = (sel, label) => `(() => { const box = document.querySelector(${JSON.stringify(sel)}); if (!box) return;
  box.style.flexWrap = "nowrap"; box.style.overflow = "hidden";
  const chips = [...box.querySelectorAll(".chip")]; if (!chips.length) return;
  const more = document.createElement("button"); more.type = "button"; more.className = "fold-more"; box.append(more);
  const room = box.getBoundingClientRect().right - 8;
  let hid = 0; more.style.display = "none";
  for (const c of chips) { if (hid || c.getBoundingClientRect().right > room - 64) { c.style.display = "none"; hid++; } }
  if (hid) { more.style.display = ""; more.textContent = "+" + hid + " ${label}▾"; more.title = "隠れている札 " + hid + " 個を開く"; } })();`;
const FOLD_CSS = `.fold-more{flex:none;border:1px solid #b7cbe6;background:var(--accbg);color:var(--acc);border-radius:12px;padding:1px 9px;font-size:12px;font-weight:700;white-space:nowrap}
#summary .pins,.cardzone .pins{display:flex;align-items:center;gap:4px;min-width:0;flex:1}
#summary .chip,.cardzone .chip{flex:none;max-width:none}`;

// 画像表示の札を「▤ 画像表示 3 ▾」の 1 つのボタンにまとめる（押すと札の置き場が開く。ドラッグ中は置き場がそのまま受けになる）
const CARDBTN = `(() => { const z = document.querySelector(".cardzone"); const n = z.querySelectorAll(".chip").length;
  z.classList.add("cz-min"); z.insertAdjacentHTML("afterbegin", '<span class="cz-btn" title="各画像の下に出す項目（押すと開く・項目をここへドラッグ）">▤ 画像表示 <b>' + n + '</b> ▾</span>'); })();`;
const CARDBTN_CSS = `.cardzone.cz-min{flex:none;order:0;flex-basis:auto;max-width:none;border:none;padding:0;min-height:0}.cardzone.cz-min>.dzl,.cardzone.cz-min>.pins{display:none}
.cz-btn{display:inline-flex;align-items:center;gap:4px;border:1px solid #ecd9a8;background:var(--pinbg);color:var(--pin);border-radius:5px;padding:3px 10px;font-size:12.5px;font-weight:600;white-space:nowrap;cursor:pointer}
.cz-btn b{font-family:Consolas,monospace}`;

// 切り替えの段とフィルタの帯を 1 段に（フィルタの帯をそのまま切り替えの段の右に入れる。狭いときはフィルタのまとまりごと下の段へ回る）
const MERGE = [["move", "#fBar", "append", "#center .toolbar"], ["script", `document.querySelector("#center .toolbar .spacer").remove();`]];
const MERGE_CSS = `#center .toolbar{row-gap:6px}
#center .toolbar .f-bar{flex:1 1 420px;border:none;background:none;padding:0}`;

export const PROPOSALS = [
  {
    key: "A", name: "1 段に収めて溢れは「+n」（サマリ・画像表示）",
    css: CARD + FOLD_CSS + `#summary{flex-wrap:nowrap;overflow:hidden}.cardzone{flex-wrap:nowrap;overflow:hidden;max-width:none}`,
    ops: [["script", FOLD("#summary .pins", "")], ["script", FOLD(".cardzone .pins", "")]],
  },
  {
    key: "B", name: "列と画像表示を「表示 ▾」1 つにまとめ、切り替えとフィルタを 1 段に",
    css: CARD + MERGE_CSS + `#sizerWrap,.cardzone{display:none!important}
.vw-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid #b7cbe6;background:var(--pane);color:var(--acc);border-radius:5px;padding:3px 10px;font-size:12.5px;white-space:nowrap;cursor:pointer}
.vw-btn b{font-family:Consolas,monospace}`,
    ops: [["insert", '<span class="vw-btn" title="カードの列の数・カードの下に出す項目（押すと開く・項目をここへドラッグ）">▦ 表示 列 <b>5</b>・項目 <b>3</b> ▾</span>', "afterend", "#sizerWrap"], ...MERGE,
      ["script", `const h = document.querySelector("#fChips .f-none"); if (h) { h.title = h.textContent; h.textContent = "なし"; }`]],
  },
  {
    key: "C", name: "サマリを見出しの暗い帯へ（パンくずの右）",
    css: CARD + FOLD_CSS + `#summary{margin:0;border:none;background:none;padding:0;flex:1;min-width:0;flex-wrap:nowrap;overflow:hidden;min-height:0}
#summary .dzl{display:none}
#summary .chip{background:#2c3a4f;border-color:#3d4d66;color:#e8edf3;font-size:12.5px}#summary .chip .cl{color:#ffd27a}#summary .chip .x{color:#9fb0c6}
#summary .fold-more{background:#2c3a4f;border-color:#4a5d7a;color:#cfe0f7}
header .crumb{flex:none}.cardzone{flex-wrap:nowrap;overflow:hidden;max-width:none}`,
    ops: [["move", "#summary", "after", "header .crumb"], ["script", FOLD("#summary .pins", "")], ["script", FOLD(".cardzone .pins", "")]],
  },
  {
    key: "D", name: "一覧を送ると帯が縮む（サマリと画像表示が 1 行の要約に）",
    css: CARD + FOLD_CSS + `#summary.shrunk{flex-wrap:nowrap;overflow:hidden;min-height:0;padding:3px 8px;cursor:pointer}
#summary.shrunk .chip{border:none;background:none;padding:0 6px 0 0;font-size:12.5px}#summary.shrunk .chip .x{display:none}
#summary.shrunk .dzl{flex:none;white-space:nowrap}
.cardzone.shrunk{display:none}`,
    ops: [["script", `document.getElementById("summary").classList.add("shrunk"); document.querySelector(".cardzone").classList.add("shrunk");
      document.getElementById("grid").scrollTop = 160;`], ["script", FOLD("#summary .pins", "")]],
  },
  {
    key: "E", name: "札の枠を外して密に並べる（名前は薄く・値は濃く・× は指を乗せたとき）",
    css: CARD + `#summary .chip,.cardzone .chip{background:none;border:none;border-radius:0;padding:0 8px 0 0;margin-right:4px;border-right:1px solid var(--line);font-size:13px}
#summary .chip .cl,.cardzone .chip .cl{color:var(--sub);font-weight:400}#summary .chip .cv{color:var(--txt)}
#summary .chip .x,.cardzone .chip .x{visibility:hidden;width:0;padding:0}#summary .chip:hover .x,.cardzone .chip:hover .x{visibility:visible;width:auto;padding:0 3px}
.cardzone .chip{color:var(--txt);font-weight:600;font-size:12.5px}
.cardzone{max-width:none}`,
    ops: [],
  },
  {
    key: "F", name: "A＋画像表示を 1 つのボタンに（サマリ・切り替え・フィルタを各 1 段の薄い段に）",
    css: CARD + FOLD_CSS + CARDBTN_CSS + MERGE_CSS + `#summary{flex-wrap:nowrap;overflow:hidden}`,
    ops: [["script", FOLD("#summary .pins", "")], ["script", CARDBTN], ...MERGE],
  },
];
