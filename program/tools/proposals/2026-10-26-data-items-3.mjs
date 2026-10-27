// データ項目の案（3 回目・最後の回）。2 回目（2026-10-26-data-items-2.mjs）は 1 位 K が 77.3 点で 80 点に届かなかった。
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-10-26-data-items-3.mjs
//
// 2 回目の採点で低かった所と、この回で直す所:
//  - 1280 で「＋ 追加」が切れる・列の外に出る（−5・−10）→ 追加の列をやめ、行の中の小さな ＋、または行を選ぶと出る置き先のボタンにする
//  - 表示先の並びがタブで左と右に変わる（統一感 14）→ 表示先はいつも右の 1 か所
//  - 置き先のボタンに置き済みの印が無い（−3）→ 置き済みは ✓ と押された見た目
//  - 「幅」で探してもロットの「板幅」などが当たらない（全案）→ 置いてある項目は表示名（表示項目の名前）でも当たる
//  - 位置の小さな図が小さすぎる → 40×28px
// 持ち越し: A2（直した A3）。新しい案: L（表示先を選ぶとチェックの列）・M（行を選ぶと置き先のトグル）・N（画像ごと／ロットに分けて並べる）・
// O（項目 × 表示先の表。升目を押して出し入れ）
import { CSS, render } from "./2026-10-26-data-items.mjs";

export { STATES } from "./2026-10-26-data-items.mjs";

// 表示項目の名前で引けるように（行の名前を、置いてある表示項目の名前にする。作るときも同じ）
const PINS = ["script", "fetch('/api/pins').then((r) => r.json()).then((j) => { window.__pins = j; window.__drender && window.__drender(); })"];
const PRE = `
const PINL = new Map((window.__pins || []).map((p) => [p.file + "|" + p.key, p.label]));
for (const g of groups) for (const r of g.rows) { const l = PINL.get(r.file + "|" + r.key); if (l) r.label = l; }
const POS = { list: [0, 0, 22, 100], summary: [25, 0, 47, 20], card: [25, 24, 47, 14], image: [75, 0, 25, 30], mapx: [75, 34, 25, 12], mapy: [75, 48, 25, 12], lot: [75, 64, 25, 36] };
const ico = (pl) => '<span class="jico">' + Object.entries(POS).map(([k, [x, y, w, h]]) => '<i style="left:' + x + '%;top:' + y + '%;width:' + w + '%;height:' + h + '%"' + (k === pl ? ' class="on"' : "") + "></i>").join("") + "</span>";
const isPlaced = (r, pl) => (placedOf.get(r.label) || []).includes(pl);
const allowed = (r) => Object.keys(PLACE).filter((pl) => NEED[pl] === "any" || NEED[pl] === r.scope);
const tags2 = (r) => { const t = placedOf.get(r.label) || []; return t.slice(0, 2).map((p) => '<span class="dpl">' + PLACE[p] + "</span>").join("") + (t.length > 2 ? '<span class="dpl more">+' + (t.length - 2) + "</span>" : ""); };
const cell1 = (r) => '<td class="dl1"><span class="grip">⠿</span><b>' + hl(r.label) + '</b><small>' + hl(r.key) + " " + scopeTag(r.scope) + "</small></td>";
const cellV = (r) => '<td class="dv" title="' + esc(r.val) + '">' + hl(r.val || "—") + "</td>";
const visGroups = () => (Q ? groups.filter((g) => g.rows.some(hit)) : groups.slice(0, 1));
const gh = (g, n) => '<div class="dgh">' + esc(g.src) + "：<b>" + esc(g.name) + '</b><span class="sub"> ' + n + " 件</span></div>";
const placesR = (cur) => '<div class="dcol dplaces"><div class="sub" style="font-size:12px;white-space:nowrap">' + (CUR !== undefined && typeof LMODE !== "undefined" ? "表示先（ドラッグで置く・押して選ぶ）" : "表示先（ここへドラッグ）") + "</div>" +
  Object.keys(PLACE).map((pl) => '<div class="dplace' + (pl === cur ? " cur" : "") + (dragScope ? (okPlace(pl) ? " ok" : " ng") : "") + '"><div class="dph">' + ico(pl) + "<b>" + PLACE[pl] + '</b><span class="sub">' + PLACE_SUB[pl] + "</span>" + scopeTag(NEED[pl] === "any" ? "lot" : NEED[pl]).replace("ロット", NEED[pl] === "any" ? "どちらも" : "ロット") + '</div><div class="dchips">' +
  (chipsOf(pl).map((l) => '<span class="chip"><span class="cl">' + esc(l) + "</span></span>").join("") || '<span class="hint">ここへドラッグ</span>') + "</div></div>").join("") + "</div>";
`;
const C3 = CSS + `
.dbox{max-width:1260px}
.dsearch{border:2px solid #b7cbe6;padding:6px 12px;border-radius:8px}.dsearch input{font-size:15px}.dsearch .ic{font-size:18px;color:var(--acc)}
.dhead{padding:12px 16px}
.dtab{table-layout:fixed}.dtab td{padding:4px 6px}
.dl1{width:auto;position:relative;padding-left:20px!important}.dl1 .grip{position:absolute;left:4px;top:50%;transform:translateY(-50%);margin:0}
.dph .sub{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}.dph b{white-space:nowrap}.dl1 b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dl1 small{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dl1 small .dsc{font-family:"Yu Gothic UI",sans-serif;margin-left:4px;font-size:10.5px;padding:0 5px}
.dv{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:170px}
.dps3{width:200px;white-space:nowrap;overflow:hidden}.dpl.more{color:var(--sub);background:var(--line2);border-color:var(--line)}
.dplus{width:34px}.dplus button{width:26px;height:24px;padding:0;font-size:15px;line-height:20px;color:var(--acc);border-color:#b7cbe6}
.dplaces{width:310px;flex:0 0 auto}.dplace .dph{align-items:center}.dplace.cur{border-style:solid;border-color:var(--acc);background:var(--accbg);box-shadow:0 0 0 1px var(--acc)}
.jico{position:relative;display:inline-block;width:34px;height:24px;border:1px solid #8a94a2;border-radius:3px;margin-right:4px;background:var(--pane);flex:0 0 auto}
.jico i{position:absolute;background:#dfe4ea;border:0.5px solid #fff}.jico i.on{background:var(--acc)}`;

const modal3 = (sub, inner) => `ui.innerHTML = modal("94vw", "min(840px,90vh)", head("データ項目", ${JSON.stringify(sub)}) + '<div class="dbody"><div class="dcol dcats">' + cats() + '</div><div class="dcol dmain">' + search + ${inner} + '</div>' + placesR(CUR) + "</div>");`;

// A3: 行の右は置き済みの札（2 つまで ＋n）と小さな ＋
const A3 = `const CUR = null;
const rows = visGroups().map((g) => { const rs = g.rows.filter(hit); return gh(g, rs.length) + '<table class="dtab"><colgroup><col><col style="width:170px"><col style="width:200px"><col style="width:34px"></colgroup>' +
  rs.map((r) => '<tr class="drow' + (r.key === dragKey ? " dragging" : "") + '">' + cell1(r) + cellV(r) + '<td class="dps3">' + tags2(r) + '</td><td class="dplus"><button type="button" title="表示先を選んで置く">＋</button></td></tr>').join("") + "</table>"; }).join("");
${modal3("探して、右の表示先へドラッグ（＋ で表示先を選んで置く）", "rows")}`;

// L: 表示先を選ぶと、表の左にその先のチェックの列（置ける項目だけ）
const L = `const LMODE = 1, CUR = state === "drag" ? null : "card";
const rows = visGroups().map((g) => { const rs = g.rows.filter(hit).filter((r) => !CUR || allowed(r).includes(CUR)); if (!rs.length) return ""; return gh(g, rs.length) + '<table class="dtab"><colgroup>' + (CUR ? '<col style="width:34px">' : "") + '<col><col style="width:170px"><col style="width:200px"></colgroup>' +
  rs.map((r) => '<tr class="drow' + (r.key === dragKey ? " dragging" : "") + '">' + (CUR ? '<td class="lck"><input type="checkbox"' + (isPlaced(r, CUR) ? " checked" : "") + "></td>" : "") + cell1(r) + cellV(r) + '<td class="dps3">' + tags2(r) + "</td></tr>").join("") + "</table>"; }).join("");
const bar = CUR ? '<div class="lbar">' + ico(CUR) + '<b>' + PLACE[CUR] + '</b><span class="lbt">に出す項目をチェック（置ける「画像ごと」の項目だけ）</span><span class="spacer"></span><button type="button" class="lnk">選ぶのをやめる</button></div>' : "";
${modal3("探して、右の表示先へドラッグ／表示先を選ぶとチェックで出し入れ", "bar + rows")}`;

// M: 行を選ぶと、その行の下に置き先のトグル（置き済みは ✓ で押された見た目）
const M = `const CUR = null;
const first = groups.flatMap((g) => g.rows).find(hit);
const toggles = (r) => '<tr class="mq"><td colspan="3"><span class="sub">置く先:</span>' + allowed(r).map((pl) => '<button type="button" class="mb' + (isPlaced(r, pl) ? " on" : "") + '">' + ico(pl) + PLACE[pl] + (isPlaced(r, pl) ? " ✓" : "") + "</button>").join("") + "</td></tr>";
const rows = visGroups().map((g) => { const rs = g.rows.filter(hit); return gh(g, rs.length) + '<table class="dtab"><colgroup><col><col style="width:170px"><col style="width:200px"></colgroup>' +
  rs.map((r) => '<tr class="drow' + (r.key === dragKey ? " dragging" : "") + (state !== "drag" && r === first ? " picked" : "") + '">' + cell1(r) + cellV(r) + '<td class="dps3">' + tags2(r) + "</td></tr>" + (state !== "drag" && r === first ? toggles(r) : "")).join("") + "</table>"; }).join("");
${modal3("探して、右の表示先へドラッグ／行を選んで置く先を押す", "rows")}`;

// N: 項目を「画像ごと」「ロット」の 2 つに分けて並べる（分類の列も 2 つの見出しの下に）
const N = `const CUR = null;
const sec = (scope, title) => { const gs = groups.filter((g) => g.rows.some((r) => r.scope === scope && hit(r))); const n = gs.reduce((a, g) => a + g.rows.filter((r) => r.scope === scope && hit(r)).length, 0);
  return '<div class="nsec"><span class="dsc ' + scope + '">' + title + "</span> " + n + " 件</div>" + gs.slice(0, Q ? 9 : 1).map((g) => { const rs = g.rows.filter((r) => r.scope === scope && hit(r)); return gh(g, rs.length) + '<table class="dtab"><colgroup><col><col style="width:170px"><col style="width:200px"><col style="width:34px"></colgroup>' +
  rs.map((r) => '<tr class="drow' + (r.key === dragKey ? " dragging" : "") + '">' + cell1(r) + cellV(r) + '<td class="dps3">' + tags2(r) + '</td><td class="dplus"><button type="button">＋</button></td></tr>').join("") + "</table>"; }).join(""); };
const catsN = '<div class="ncat">画像ごと（選んだ画像の値）</div>' + cats().split("</button>").filter((b, i) => i < 2).join("</button>") + "</button>" + '<div class="ncat">ロット</div>' + cats().split("</button>").slice(2).join("</button>");
ui.innerHTML = modal("94vw", "min(840px,90vh)", head("データ項目", "探して、右の表示先へドラッグ") + '<div class="dbody"><div class="dcol dcats">' + catsN + '</div><div class="dcol dmain">' + search + sec("image", "画像ごと") + sec("lot", "ロット") + '</div>' + placesR(CUR) + "</div>");`;

// O: 項目 × 表示先の表。置ける升目だけに丸、置き済みは ✓。押して出し入れ（ドラッグで並べ替えは表示先で）
const O = `const PL = Object.keys(PLACE), SHORT = { list: "一覧", summary: "サマリ", lot: "ロット情報", card: "画像表示", image: "画像情報", mapx: "MAP横", mapy: "MAP縦" };
const head7 = '<tr class="oh"><th></th><th></th>' + PL.map((pl) => '<th>' + ico(pl) + "<br>" + SHORT[pl] + "</th>").join("") + "</tr>";
const rows = visGroups().map((g) => { const rs = g.rows.filter(hit); return gh(g, rs.length) + '<table class="dtab otab"><colgroup><col><col style="width:150px">' + PL.map(() => '<col style="width:62px">').join("") + "</colgroup>" + head7 +
  rs.map((r) => '<tr class="drow' + (r.key === dragKey ? " dragging" : "") + '">' + cell1(r) + cellV(r) + PL.map((pl) => '<td class="oc">' + (allowed(r).includes(pl) ? '<button type="button" class="ob' + (isPlaced(r, pl) ? " on" : "") + '">' + (isPlaced(r, pl) ? "✓" : "") + "</button>" : '<span class="ox">—</span>') + "</td>").join("") + "</tr>").join("") + "</table>"; }).join("");
ui.innerHTML = modal("94vw", "min(840px,90vh)", head("データ項目", "升目を押すと、その表示先に出す・外す（— は置けない所）") + '<div class="dbody"><div class="dcol dcats">' + cats() + '</div><div class="dcol dmain">' + search + rows + "</div></div>");
if (state === "drag") ui.querySelector(".dsearch").insertAdjacentHTML("afterend", '<div class="sub">（この案はドラッグを使わない。升目を押す）</div>');`;

const LCSS = `.lck{text-align:center}.lck input{width:16px;height:16px}.lbar b{white-space:nowrap}.lbar .lbt{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.lbar .lnk{white-space:nowrap}.lbar{display:flex;align-items:center;gap:6px;padding:6px 10px;background:var(--accbg);border:1px solid #b7cbe6;border-radius:6px;font-size:12.5px;margin-top:6px}`;
const MCSS = `.drow.picked td{background:#e7effa}.mq td{background:#f3f7fc;padding:6px 8px 8px}.mb .jico{width:24px;height:17px}.mb{margin:3px 3px 3px 3px;font-size:12px;padding:2px 8px 2px 3px;display:inline-flex;align-items:center;white-space:nowrap;border-radius:6px}
.mb.on{background:var(--acc);border-color:var(--acc);color:#fff}.mb.on .jico{border-color:#fff}`;
const NCSS = `.ncat{font-size:11.5px;color:var(--sub);font-weight:700;margin:8px 8px 2px}.nsec{margin:12px 0 0;font-size:13px;font-weight:700;display:flex;gap:6px;align-items:center}.nsec .dsc{font-size:12px}`;
const OCSS = `.otab th{font-size:11px;font-weight:400;color:var(--sub);padding:2px 0 4px;text-align:center;line-height:13px}.otab th .jico{width:26px;height:18px;margin:0}
.oc{text-align:center}.ob{width:24px;height:22px;padding:0;border-radius:5px;border:1.5px solid #b7cbe6;background:var(--pane);color:#fff;font-size:13px;line-height:18px}.ob.on{background:var(--acc);border-color:var(--acc)}.ox{color:#c5ccd6}`;

const op = (body) => [PINS, render(PRE + body)];
export const PROPOSALS = [
  { key: "now", name: "今（右列の下の枠）",
    ops: [["script", "document.getElementById('srcBox').open=true;document.querySelectorAll('#srcList details').forEach((d,i)=>{if(i<2)d.open=true});document.getElementById('srcBox').scrollIntoView();"]] },
  { key: "A3", name: "A2 を直した（追加は行の中の小さな ＋・札は 2 つまで＋n・表示名でも探せる）", css: C3, ops: op(A3) },
  { key: "L", name: "表示先を選ぶと、表の左にその先のチェックの列（置ける項目だけ）。ドラッグでも置ける", css: C3 + LCSS, ops: op(L) },
  { key: "M", name: "行を選ぶと、その行の下に置き先のトグル（置き済みは ✓）。ドラッグでも置ける", css: C3 + MCSS, ops: op(M) },
  { key: "N", name: "項目を「画像ごと」「ロット」に分けて並べる（どこに置けるかが並びで分かる）", css: C3 + NCSS, ops: op(N) },
  { key: "O", name: "項目 × 表示先の表（升目を押して出し入れ。置けない所は —）", css: C3 + OCSS, ops: op(O) },
];
