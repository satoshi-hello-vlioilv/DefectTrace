// データ項目の案（2 回目）。1 回目（2026-10-26-data-items.mjs）は 1 位 A が 77.3 点で 80 点に届かなかった。
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-10-26-data-items-2.mjs
//
// 1 回目の採点で低かった所と、この回で直す所:
//  - 値が 2 段に折れる（−3）→ 値は 1 行（長い物は … で省き、指すと全部）
//  - 名前・値・札の間が空きすぎ、表示先の列の下が空く（整列 7）→ 列の幅を詰め、窓を 1240px に
//  - 3 列の重みが同じで、最初に見る物が弱い（階層 7）→ 検索欄を大きく、窓の頭に
//  - 当たりの無い分類も同じ濃さ → 薄くする
//  - 置く先が窓の中の代わりの枠で、本物の位置が分からない（直感 8）→ 新しい案で 3 方向を試す
// 持ち越し: A（直した A2）。新しい案: G（表示先を画面の位置どおりに並べる）・J（位置の小さな図＋行から 1 手で置く）・
// H（ドラッグ中は窓が透け、本物の枠も光る）・K（「項目から／表示先から」の 2 つの入口）
import { CSS, render } from "./2026-10-26-data-items.mjs";

export { STATES } from "./2026-10-26-data-items.mjs";

const A2 = CSS + `
.dbox{max-width:1240px}
.dsearch{border:2px solid #b7cbe6;padding:6px 12px;border-radius:8px}.dsearch input{font-size:15px}.dsearch .ic{font-size:18px;color:var(--acc)}
.dtab td{padding:4px 6px}.dl1{width:auto;min-width:210px}
.dv{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;width:200px}
.dtab td:nth-child(3){width:76px}.dps{white-space:normal;min-width:110px}.dps .dpl{margin:1px 3px 1px 0}
.dhead{padding:12px 16px}`;
const body3 = (places) => `ui.innerHTML = modal("94vw", "min(840px,90vh)", head("データ項目", "探して、右の表示先へドラッグ") +
  '<div class="dbody"><div class="dcol dcats">' + cats() + '</div><div class="dcol dmain">' + search + table({ n: 1, add: true }) + '</div>' + ${places} + "</div>");`;
const placesCol = `'<div class="dcol dplaces"><div class="sub" style="font-size:12px">表示先（ここへドラッグ。置ける所が緑）</div>' + placesHtml() + "</div>"`;

// 画面の位置どおりの表示先（G）
const LAYOUT = `
const box = (pl, x, y, w, h) => '<div class="dplace gpl' + (dragScope ? (okPlace(pl) ? " ok" : " ng") : "") + '" style="left:' + x + '%;top:' + y + '%;width:' + w + '%;height:' + h + '%"><div class="dph"><b>' + PLACE[pl] + '</b></div><div class="dchips">' +
  (chipsOf(pl).map((l) => '<span class="chip"><span class="cl">' + esc(l) + "</span></span>").join("") || '<span class="hint">ここへ</span>') + "</div></div>";
const layout = '<div class="dcol dplaces glay"><div class="sub" style="font-size:12px">表示先（画面の中の位置どおり。置ける所が緑）</div><div class="gwf"><div class="gbar"></div>' +
  box("list", 0, 4, 24, 96) + box("summary", 26, 4, 46, 22) + box("card", 26, 28, 46, 18) + '<div class="gimg">画像一覧</div>' +
  box("image", 74, 4, 26, 24) + box("mapx", 74, 30, 26, 13) + box("mapy", 74, 45, 26, 13) + box("lot", 74, 60, 26, 40) + "</div></div>";`;
const GCSS = `
.glay{width:clamp(340px,25vw,460px);flex:0 0 auto}.gwf{position:relative;flex:1;min-height:420px;border:1px solid var(--line);border-radius:6px;background:var(--pane);margin-top:4px}
.gbar{position:absolute;left:0;right:0;top:0;height:3%;background:#1f2a3a;border-radius:5px 5px 0 0}
.gpl{position:absolute;padding:3px 5px;overflow:hidden}.gpl .dchips .chip{font-size:11px;padding:0 6px;max-width:100%}.gpl .chip .cl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gimg{position:absolute;left:26%;top:48%;width:46%;height:52%;border:1px solid var(--line2);border-radius:4px;color:var(--sub);font-size:11px;padding:4px}`;

// 位置の小さな図（J）
const ICON = `
const POS = { list: [0, 0, 22, 100], summary: [25, 0, 47, 20], card: [25, 24, 47, 14], image: [75, 0, 25, 30], mapx: [75, 34, 25, 12], mapy: [75, 48, 25, 12], lot: [75, 64, 25, 36] };
const ico = (pl) => '<span class="jico">' + Object.entries(POS).map(([k, [x, y, w, h]]) => '<i style="left:' + x + '%;top:' + y + '%;width:' + w + '%;height:' + h + '%"' + (k === pl ? ' class="on"' : "") + "></i>").join("") + "</span>";
const placesJ = '<div class="dcol dplaces"><div class="sub" style="font-size:12px">表示先（ここへドラッグ。置ける所が緑）</div>' + placesHtml().replace(/<div class="dph"><b>([^<]+)<\\/b>/g, (m, t) => { const pl = Object.keys(PLACE).find((k) => PLACE[k] === t); return '<div class="dph">' + ico(pl) + "<b>" + t + "</b>"; }) + "</div>";
// 行を選ぶと、その行に置ける先のボタンが出る（1 手で置く）
const quick = (r) => '<tr class="jq"><td colspan="5"><span class="sub">ここへ置く:</span>' + Object.keys(PLACE).filter((pl) => NEED[pl] === "any" || NEED[pl] === r.scope).map((pl) => '<button type="button" class="jb">' + ico(pl) + PLACE[pl] + "</button>").join("") + "</td></tr>";`;
const JCSS = `
.jico{position:relative;display:inline-block;width:26px;height:18px;border:1px solid #9aa3ad;border-radius:2px;margin-right:6px;vertical-align:-3px;background:var(--pane);flex:0 0 auto}
.jico i{position:absolute;background:#e3e7ec}.jico i.on{background:var(--acc)}
.jq td{background:#f3f7fc;padding:6px 8px 8px}.jb{margin:0 6px 0 4px;font-size:12px;padding:2px 8px;display:inline-flex;align-items:center;white-space:nowrap}.jb .jico{width:20px;height:14px;margin-right:4px}
.drow.picked td{background:#e7effa}`;

export const PROPOSALS = [
  { key: "now", name: "今（右列の下の枠）",
    ops: [["script", "document.getElementById('srcBox').open=true;document.querySelectorAll('#srcList details').forEach((d,i)=>{if(i<2)d.open=true});document.getElementById('srcBox').scrollIntoView();"]] },
  { key: "A2", name: "A を直した（3 列・検索を頭に大きく・値は 1 行・列を詰める）", css: A2, ops: [render(body3(placesCol))] },
  { key: "G", name: "3 列・表示先を画面の位置どおりに並べる（どこに出るかが見て分かる）", css: A2 + GCSS, ops: [render(LAYOUT + body3("layout"))] },
  { key: "J", name: "3 列・表示先に位置の小さな図＋行を選ぶとその行に置ける先のボタン（ドラッグせずに 1 手でも）", css: A2 + JCSS,
    ops: [render(ICON + `
      const first = groups[0].rows.find(hit);
      ui.innerHTML = modal("94vw", "min(840px,90vh)", head("データ項目", "探して、右の表示先へドラッグ／行を選んで置く先を押す") +
        '<div class="dbody"><div class="dcol dcats">' + cats() + '</div><div class="dcol dmain">' + search + table({ n: 1 }) + '</div>' + placesJ + "</div>");
      if (state !== "drag") { const tr = ui.querySelector(".drow"); tr.classList.add("picked"); tr.insertAdjacentHTML("afterend", quick(first)); }`)] },
  { key: "H", name: "3 列・ドラッグ中は窓が透けて本物の枠も光る（窓の中の表示先にも、本物にも落とせる）", css: A2 + `
.dmodal.thin{background:rgba(15,25,40,.08)}.dmodal.thin .dbox{opacity:.22}
.dmodal.thin .dplaces{opacity:1}`,
    ops: [render(`if (state === "drag") lightZones(); ` + body3(placesCol) + ` if (state === "drag") { ui.querySelector(".dmodal").classList.add("thin"); ui.insertAdjacentHTML("beforeend", '<div class="dpill">⠿ <b>幅方向OS～(mm)</b> を光っている枠へ（窓の中でも本物でも）<span class="sub" style="color:#c9d3df">Esc でやめる</span></div>'); }`)] },
  { key: "K", name: "入口を 2 つ（項目から／表示先から）。表示先からは、その先に置ける項目だけをチェックで出し入れ", css: A2 + `
.ktabs{display:flex;gap:0;padding:0 16px;border-bottom:1px solid var(--line)}.ktabs button{border:none;border-bottom:3px solid transparent;border-radius:0;background:none;padding:8px 14px;font-size:13.5px;color:var(--sub)}
.ktabs button.on{color:var(--acc);border-bottom-color:var(--acc);font-weight:700}
.kpl{width:270px;flex:0 0 auto;border-right:1px solid var(--line);padding:6px;background:#f7f8fa;gap:4px}
.kpl .dplace{cursor:pointer}.kpl .dplace.cur{border-style:solid;border-color:var(--acc);background:var(--accbg)}
.kck{width:28px}.kck input{width:16px;height:16px}`,
    ops: [render(`const byPlace = state === "browse";
      const tabs = '<div class="ktabs"><button type="button"' + (byPlace ? "" : ' class="on"') + '>項目から探す</button><button type="button"' + (byPlace ? ' class="on"' : "") + ">表示先から選ぶ</button></div>";
      if (byPlace) {
        const pl = "card", rows = groups.filter((g) => g.rows.some((r) => r.scope === "image"));
        const list = rows.map((g) => '<div class="dgh">' + esc(g.src) + "：<b>" + esc(g.name) + '</b></div><table class="dtab">' + g.rows.filter((r) => r.scope === "image").map((r) => '<tr class="drow"><td class="kck"><input type="checkbox"' + (chipsOf(pl).includes(r.label) ? " checked" : "") + '></td><td class="dl1"><b>' + esc(r.label) + "</b><small>" + esc(r.key) + '</small></td><td class="dv">' + esc(r.val || "—") + '</td><td class="dps">' + placedTags(r) + "</td></tr>").join("") + "</table>").join("");
        ui.innerHTML = modal("94vw", "min(840px,90vh)", head("データ項目", "表示先を選び、出したい項目にチェック") + tabs +
          '<div class="dbody"><div class="dcol kpl">' + placesHtml().replace('<div class="dplace"><div class="dph"><b>画像表示', '<div class="dplace cur"><div class="dph"><b>画像表示') + '</div><div class="dcol dmain">' + search + '<div class="sub" style="font-size:12px">「画像表示（各画像の下）」に置ける項目（画像ごと）だけを出しています。チェックで出し入れ・ドラッグで並べ替え</div>' + list + "</div></div>");
      } else { ${body3(placesCol).replace('head("データ項目", "探して、右の表示先へドラッグ") +', 'head("データ項目", "探して、右の表示先へドラッグ") + tabs +')} }`)] },
];
