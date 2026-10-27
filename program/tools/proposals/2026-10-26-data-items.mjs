// データ項目（表示先へドラッグする元）の案（1 回目）。
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-10-26-data-items.mjs
//
// 今の困りごと（今の画面 src-1728-now.png で見えたこと）:
//  - 右列のいちばん下の小さな枠。開いてスクロールすると、落とし先（画像情報・MAP の横/縦・ロット情報）が画面の外へ押し出される
//  - 幅 360px に名前・キー・値を詰め、値と見出しが折り返す。どの項目がもうどこへ置かれているかが分からない
// 案の方向（何で解くか）: 置き場（中央の大きな窓・左に寄せた板・下からのシート）× 落とし先の見せ方（窓の中に表示先・
// ドラッグ中は窓が退いて本物の枠が光る・画面の配置図）× 流れ（項目から／表示先から）
//
// どの案も項目はページの本物（#srcList の行）から集める。入口は見出しの「データ項目」ボタン（右列の枠はやめる）。
// 状態: browse（開いた直後）・search（「幅」で探した）・drag（「幅」の行をドラッグしている）

export const COMMON = String.raw`
const PLACE = { list: "ロット一覧", summary: "サマリ", lot: "ロット情報", card: "画像表示", image: "画像情報", mapx: "MAP 横軸", mapy: "MAP 縦軸" };
const NEED = { list: "lot", summary: "lot", lot: "lot", card: "image", image: "any", mapx: "image", mapy: "image" };
const PLACE_SUB = { list: "左のロット一覧の各行", summary: "中央上の帯", lot: "右列", card: "各画像の下", image: "右列の上", mapx: "MAP の横", mapy: "MAP の縦" };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const chipsOf = (pl) => [...document.querySelectorAll('.pins[data-place="' + pl + '"] .chip .cl')].map((e) => e.textContent);
const placedOf = new Map();
for (const pl of Object.keys(PLACE)) for (const l of chipsOf(pl)) placedOf.set(l, [...(placedOf.get(l) || []), pl]);
document.querySelectorAll('#imgInfo tr.pinned td.k').forEach((e) => placedOf.set(e.textContent, [...(placedOf.get(e.textContent) || []), "image"]));
const groups = [...document.querySelectorAll("#srcList details.xf")].map((d) => {
  const t = d.querySelector("summary").childNodes[0].textContent.trim();
  const [src, name] = t.split("：");
  return { src, name: name || t, rows: [...d.querySelectorAll("tr.src")].map((tr) => ({ label: tr.dataset.label || tr.dataset.key.split(/[/@]/).filter(Boolean).pop(), key: tr.dataset.key, val: tr.dataset.val, scope: tr.dataset.scope })) };
}).filter((g) => g.rows.length);
const state = document.body.dataset.state;
const Q = state === "search" || state === "drag" ? "幅" : "";
const hit = (r) => !Q || (r.label + " " + r.key + " " + r.val).includes(Q);
const hl = (s) => (Q ? esc(s).split(Q).join('<mark>' + Q + '</mark>') : esc(s));
const scopeTag = (s) => '<span class="dsc ' + s + '">' + (s === "image" ? "画像ごと" : "ロット") + "</span>";
const placedTags = (r) => (placedOf.get(r.label) || []).map((p) => '<span class="dpl">' + PLACE[p] + "</span>").join("");
const dragKey = state === "drag" ? groups.flatMap((g) => g.rows).find((r) => r.label.includes("幅"))?.key : null;
function rowsHtml(g, opt = {}) {
  return g.rows.filter(hit).map((r) => '<tr class="drow' + (r.key === dragKey ? " dragging" : "") + '"><td class="dl1"><span class="grip">⠿</span><b>' + hl(r.label) + "</b><small>" + hl(r.key) + "</small></td><td class=\"dv\">" + hl(r.val || "—") + "</td>" +
    (opt.noScope ? "" : "<td>" + scopeTag(r.scope) + "</td>") + '<td class="dps">' + placedTags(r) + "</td>" + (opt.add ? '<td><button type="button" class="dadd">＋ 追加</button></td>' : "") + "</tr>").join("");
}
function table(opt = {}) {
  const gs = Q ? groups.filter((g) => g.rows.some(hit)) : groups.slice(opt.from || 0, (opt.from || 0) + (opt.n || 1));
  return gs.map((g) => '<div class="dgh">' + esc(g.src) + "：<b>" + esc(g.name) + '</b><span class="sub"> ' + g.rows.filter(hit).length + " 件</span></div><table class=\"dtab\">" + rowsHtml(g, opt) + "</table>").join("") || '<div class="hint">見つかりません</div>';
}
function cats(active = 0) {
  return groups.map((g, i) => '<button type="button" class="dcat' + (i === active && !Q ? " on" : "") + (Q && !g.rows.some(hit) ? " zero" : "") + '"><span>' + esc(g.src) + "：" + esc(g.name) + '</span><span class="n">' + (Q ? g.rows.filter(hit).length : g.rows.length) + "</span></button>").join("");
}
const dragScope = dragKey ? groups.flatMap((g) => g.rows).find((r) => r.key === dragKey).scope : null;
const okPlace = (pl) => !dragScope || NEED[pl] === "any" || NEED[pl] === dragScope;
function placesHtml(cls = "dplace") {
  return Object.keys(PLACE).map((pl) => '<div class="' + cls + (dragScope ? (okPlace(pl) ? " ok" : " ng") : "") + '"><div class="dph"><b>' + PLACE[pl] + '</b><span class="sub">' + PLACE_SUB[pl] + "</span>" + scopeTag(NEED[pl] === "any" ? "lot" : NEED[pl]).replace("ロット", NEED[pl] === "any" ? "どちらも" : "ロット") + "</div>" +
    '<div class="dchips">' + (chipsOf(pl).map((l) => '<span class="chip"><span class="cl">' + esc(l) + "</span></span>").join("") || '<span class="hint">ここへドラッグ</span>') + "</div></div>").join("");
}
const search = '<div class="dsearch"><span class="ic">⌕</span><input type="search" value="' + Q + '" placeholder="項目名・キー・値で探す（Ctrl+F）"><span class="sub">' + (Q ? groups.flatMap((g) => g.rows).filter(hit).length + " 件" : groups.flatMap((g) => g.rows).length + " 項目") + "</span></div>";
const modal = (w, h, inner, extra = "") => '<div class="dmodal" ' + extra + '><div class="dbox" style="width:' + w + ';height:' + h + '">' + inner + "</div></div>";
const head = (t, sub) => '<div class="dhead"><b>' + t + '</b><span class="sub">' + sub + '</span><span class="spacer"></span><button type="button" class="mclose">×</button></div>';
// 右列の今の枠は消し、見出しに入口を置く
document.getElementById("srcBox").style.display = "none";
document.getElementById("btnReset").insertAdjacentHTML("beforebegin", '<button type="button" class="ghost dopen">☰ データ項目</button>');
const ui = document.createElement("div"); ui.id = "dui"; document.body.append(ui);
// ドラッグ中は、本物の落とし先のうち置ける物を光らせる（窓が退く案で使う）
function lightZones() {
  document.querySelectorAll(".dz[data-drop]").forEach((z) => z.classList.add(okPlace(z.dataset.drop) ? "dzok" : "dzng"));
  document.querySelector(".listzone").classList.add("open");
}
`;

export const CSS = `
#dui mark{background:#ffe58a;color:inherit;border-radius:2px;padding:0 1px}
button.ghost.dopen{color:#fff;border-color:#7d8da3}
.dmodal{position:fixed;inset:0;background:rgba(15,25,40,.45);z-index:40;display:flex;align-items:center;justify-content:center}
.dbox{background:var(--pane);border-radius:10px;box-shadow:0 20px 50px rgba(0,0,0,.35);display:flex;flex-direction:column;min-height:0;overflow:hidden}
.dhead{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--line)}.dhead b{font-size:16px}
.dbody{flex:1;display:flex;min-height:0}
.dcol{display:flex;flex-direction:column;min-height:0;overflow:auto}
.dcats{width:270px;flex:0 0 auto;border-right:1px solid var(--line);padding:6px;gap:2px;background:#f7f8fa}
.dcat{white-space:nowrap;display:flex;justify-content:space-between;gap:6px;text-align:left;border:none;background:none;padding:5px 8px;border-radius:5px;font-size:12.5px;color:var(--txt)}
.dcat span:first-child{overflow:hidden;text-overflow:ellipsis}.dcat.zero{opacity:.4}.dcat .n{color:var(--sub);font-size:12px}.dcat.on{background:var(--accbg);color:var(--acc);font-weight:700}.dcat:hover{background:#eef2f7}
.dmain{flex:1;padding:8px 12px;gap:6px}
.dsearch{display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:6px;padding:4px 10px;background:var(--pane);position:sticky;top:0;z-index:1}
.dsearch input{flex:1;border:none;font-size:14px;padding:4px 0;outline:none}.dsearch .ic{color:var(--sub);font-size:16px}
.dgh{font-size:12px;color:var(--sub);margin:8px 0 2px;padding-bottom:2px;border-bottom:1px solid var(--line)}.dgh b{color:var(--txt)}
.dtab{width:100%;border-collapse:collapse;font-size:13px}
.dtab td{padding:4px 6px;border-bottom:1px solid var(--line2);vertical-align:middle}
.drow{cursor:grab}.drow:hover td{background:#f3f7fc}
.drow.dragging td{background:#e7effa}.drow.dragging td:first-child{box-shadow:inset 3px 0 0 var(--acc)}
.dl1{width:40%}.dl1 b{font-weight:600}.dl1 small{display:block;font:11px Consolas,monospace;color:var(--sub)}
.grip{color:#b0b8c3;margin-right:6px;font-size:12px}
.dv{font-family:Consolas,monospace;font-size:12.5px;width:24%}
.dsc{display:inline-block;font-size:11px;border-radius:9px;padding:0 7px;border:1px solid;white-space:nowrap}
.dsc.lot{color:#1b5e20;border-color:#9ccc9c;background:#eef7ee}.dsc.image{color:#6a3d9a;border-color:#cdb6e6;background:#f5effb}
.dps{white-space:nowrap}.dpl{display:inline-block;font-size:11px;color:var(--pin);background:var(--pinbg);border:1px solid #ecd9a8;border-radius:9px;padding:0 6px;margin-right:3px}
.dadd{white-space:nowrap;font-size:12px;padding:2px 8px;color:var(--acc);border-color:#b7cbe6}
.dplaces{width:300px;border-left:1px solid var(--line);padding:8px;gap:6px;background:#f7f8fa}
.dplace{border:1.5px dashed var(--line);border-radius:6px;padding:5px 7px;background:var(--pane)}
.dplace.ok{border-color:var(--ok);background:var(--drop)}.dplace.ng{opacity:.4}
.dph{display:flex;align-items:baseline;gap:6px;font-size:12.5px}.dph .sub{font-size:11px;flex:1}
.dchips{display:flex;flex-wrap:wrap;gap:3px;margin-top:3px;min-height:20px}.dchips .chip{font-size:11.5px;padding:0 8px;cursor:default}
.dz.dzok{outline:3px solid var(--ok)!important;outline-offset:-1px;background:var(--drop)!important}
.dz.dzng{opacity:.45}
.dpill{position:fixed;left:50%;bottom:44px;transform:translateX(-50%);z-index:45;background:#1f2a3a;color:#fff;border-radius:22px;padding:8px 18px;font-size:13.5px;box-shadow:0 8px 24px rgba(0,0,0,.3);display:flex;gap:10px;align-items:center}
.dpill b{color:#ffd27a}
`;

// 状態ごとに作り直す（STATES が data-state を変えてから、案の「描く」を呼ぶ）
export const render = (body) => ["script", `window.__drender = () => { document.getElementById('dui')?.remove(); document.querySelectorAll('.dopen,.dpill').forEach((e) => e.remove());
  document.querySelectorAll('.dzok,.dzng').forEach((z) => z.classList.remove('dzok','dzng')); ${COMMON}
  ${body} }; window.__drender();`];
export const STATES = {
  browse: "document.body.dataset.state='browse';window.__drender&&window.__drender()",
  search: "document.body.dataset.state='search';window.__drender&&window.__drender()",
  drag: "document.body.dataset.state='drag';window.__drender&&window.__drender()",
};

export const PROPOSALS = [
  { key: "now", name: "今（右列の下の枠）",
    ops: [["script", "document.getElementById('srcBox').open=true;document.querySelectorAll('#srcList details').forEach((d,i)=>{if(i<2)d.open=true});document.getElementById('srcBox').scrollIntoView();"]] },
  {
    key: "A", name: "中央の窓・3 列（分類｜項目｜表示先を窓の中に）", css: CSS,
    ops: [render(`ui.innerHTML = modal("min(1320px,94vw)", "min(820px,88vh)", head("データ項目", "ドラッグで右の表示先へ／行の ＋ で表示先を選んで追加") +
      '<div class="dbody"><div class="dcol dcats">' + cats() + '</div><div class="dcol dmain">' + search + table({ n: 1, add: true }) +
      '</div><div class="dcol dplaces"><div class="sub" style="font-size:12px">表示先（ここへドラッグ。置ける所が緑に光る）</div>' + placesHtml() + "</div></div>");`)],
  },
  {
    key: "B", name: "中央の窓・ドラッグを始めると窓が退き、本物の枠が光る", css: CSS,
    ops: [render(`if (state === "drag") { lightZones(); ui.innerHTML = '<div class="dpill">⠿ <b>幅(mm)</b> を置く所へ（光っている枠）<span class="sub" style="color:#c9d3df">Esc でやめる・離すと窓に戻る</span></div>'; }
      else ui.innerHTML = modal("min(1100px,92vw)", "min(820px,88vh)", head("データ項目", "行をつかむと窓が退きます。光っている枠へ落としてください") +
      '<div class="dbody"><div class="dcol dcats">' + cats() + '</div><div class="dcol dmain">' + search + table({ n: 1 }) + "</div></div>");`)],
  },
  {
    key: "C", name: "左に寄せた板（窓を閉じずに、そのまま本物の枠へ）", css: CSS + `
.dside{position:fixed;left:0;top:78px;bottom:26px;width:560px;z-index:40;background:var(--pane);border-right:1px solid var(--line);box-shadow:8px 0 24px rgba(0,0,0,.18);display:flex;flex-direction:column}
.dside .dcats{width:auto;flex-direction:row;flex-wrap:wrap;border-right:none;border-bottom:1px solid var(--line);max-height:120px}
.dside .dl1{width:46%}.dlist{border:1.5px dashed var(--line);border-radius:6px;margin:6px 12px 0;padding:4px 8px;font-size:12.5px}.dlist.ok{border-color:var(--ok);background:var(--drop)}`,
    ops: [render(`if (state === "drag") lightZones();
      ui.innerHTML = '<div class="dside">' + head("データ項目", "右の本物の枠へドラッグ") + (state === "drag" ? '<div class="dlist ' + (okPlace("list") ? "ok" : "") + '"><b>ロット一覧</b> <span class="sub">（この板の下に隠れている枠）</span></div>' : "") +
      '<div class="dcol dcats">' + cats() + '</div><div class="dcol dmain">' + search + table({ n: 1, noScope: true }) + "</div></div>";`)],
  },
  {
    key: "D", name: "下からのシート（上半分の本物の枠は見えたまま・隠れる枠はシートの頭に）", css: CSS + `
.dsheet{position:fixed;left:0;right:0;bottom:26px;height:50vh;z-index:40;background:var(--pane);border-top:1px solid var(--line);box-shadow:0 -10px 30px rgba(0,0,0,.2);display:flex;flex-direction:column}
.dsheet .grab{width:48px;height:5px;border-radius:3px;background:#c5ccd6;margin:6px auto 0}
.dtargets{display:flex;gap:6px;padding:6px 14px;border-bottom:1px solid var(--line2);align-items:center}
.dtargets .dplace{flex:0 0 auto;padding:3px 10px}.dtargets .dph{gap:4px}`,
    ops: [render(`if (state === "drag") lightZones();
      const hiddenPl = ["mapx", "mapy", "lot", "list"];
      ui.innerHTML = '<div class="dsheet"><div class="grab"></div>' + head("データ項目", "上に見えている枠へドラッグ（シートで隠れる枠は下の帯へ）") +
      '<div class="dtargets"><span class="sub" style="font-size:12px">隠れている表示先:</span>' + hiddenPl.map((pl) => '<div class="dplace' + (dragScope ? (okPlace(pl) ? " ok" : " ng") : "") + '"><div class="dph"><b>' + PLACE[pl] + '</b><span class="sub">' + chipsOf(pl).length + '</span></div></div>').join("") + '</div>' +
      '<div class="dbody"><div class="dcol dcats">' + cats() + '</div><div class="dcol dmain">' + search + table({ n: 1 }) + "</div></div></div>";`)],
  },
  {
    key: "E", name: "表示先から開く（各枠の ＋ → その枠に置ける項目だけ・クリックで追加。ドラッグも可）", css: CSS + `
.dzplus{border:1px dashed #b7cbe6;background:var(--pane);color:var(--acc);border-radius:10px;padding:0 7px;font-size:11.5px;line-height:16px}
.dtarget{display:flex;align-items:center;gap:8px;padding:8px 14px;background:var(--accbg);border-bottom:1px solid #b7cbe6;font-size:13px}.dtarget b{color:var(--acc)}`,
    ops: [render(`document.querySelectorAll(".dz[data-drop] .pins").forEach((p) => p.insertAdjacentHTML("afterend", '<button type="button" class="dzplus dopen">＋ 項目</button>'));
      if (state === "drag") { lightZones(); ui.innerHTML = '<div class="dpill">⠿ <b>幅(mm)</b> を置く所へ（光っている枠）</div>'; }
      else ui.innerHTML = modal("min(1100px,92vw)", "min(800px,86vh)", head("データ項目", "") +
        '<div class="dtarget">追加する先: <b>画像表示（各画像の下）</b><span class="sub">画像ごとの項目だけを出しています</span><span class="spacer"></span><button type="button" class="lnk">すべての項目を見る</button></div>' +
        '<div class="dbody"><div class="dcol dcats">' + cats() + '</div><div class="dcol dmain">' + search + table({ n: 1, add: true, noScope: true }).replaceAll("＋ 追加", "＋ ここに追加") + "</div></div>");`)],
  },
  {
    key: "F", name: "中央の窓・右に画面の配置図（表示先を実際の位置で見せる）", css: CSS + `
.dmapw{width:430px;flex:0 0 auto;border-left:1px solid var(--line);padding:10px;background:#f7f8fa;gap:6px}
.wf{position:relative;height:380px;border:1px solid var(--line);border-radius:6px;background:var(--pane);font-size:11.5px}
.wf>div{position:absolute;border:1.5px dashed #c5ccd6;border-radius:4px;padding:2px 4px;background:#fbfcfd;overflow:hidden}
.wf>div.ok{border-color:var(--ok);background:var(--drop)}.wf>div.ng{opacity:.4}.wf>div b{display:block}.wf .n{color:var(--sub)}
.wf .bar{background:#1f2a3a;border:none;left:0;right:0;top:0;height:14px;border-radius:5px 5px 0 0}`,
    ops: [render(`const z = (pl, x, y, w, h) => '<div class="' + (dragScope ? (okPlace(pl) ? "ok" : "ng") : "") + '" style="left:' + x + '%;top:' + y + 'px;width:' + w + '%;height:' + h + 'px"><b>' + PLACE[pl] + '</b><span class="n">' + (chipsOf(pl).join("・") || "ここへ") + "</span></div>";
      const wf = '<div class="wf"><div class="bar"></div>' + z("list", 1, 22, 21, 350) + z("summary", 24, 22, 48, 56) + z("card", 24, 84, 48, 56) + '<div style="left:24%;top:146px;width:48%;height:226px;border-style:solid;border-color:#eef0f3"><span class="n">画像一覧</span></div>' +
        z("image", 74, 22, 25, 80) + z("mapx", 74, 108, 25, 50) + z("mapy", 74, 164, 25, 50) + z("lot", 74, 220, 25, 152) + "</div>";
      ui.innerHTML = modal("min(1360px,95vw)", "min(820px,88vh)", head("データ項目", "右の配置図の、置きたい場所へドラッグ") +
      '<div class="dbody"><div class="dcol dcats">' + cats() + '</div><div class="dcol dmain">' + search + table({ n: 1 }) + '</div><div class="dcol dmapw"><div class="sub" style="font-size:12px">表示先（画面の中の位置）</div>' + wf + '<div class="sub" style="font-size:11.5px">緑＝この項目を置ける所。灰＝置けない所（ロット単位／画像ごとが合わない）</div></div></div>');`)],
  },
];
