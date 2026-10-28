// 初期の表示項目の見分け・外すときの警告・開発者が決める表示の初期値の案（3 回目）。
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-10-27-pin-defaults-3.mjs
//
// 2 回目の採点（1 位 Q5 角の形 77.9 点。合格点に届かず）から:
//  - Q5（色・輪郭・角の形・区切りの 4 つで見分ける）がいちばん分かりやすい。四角い札は入力欄・ボタンに少し似る → 角を少し丸く（5px）
//  - 見本の崩れ: 区切りを入れる文が状態ごとにもう一度動き、表の区切りが 3 段に増えた → 入れ直す前に前の区切りを外す
//  - データ項目の窓の中央の一覧の「置き先の札」（画像表示・画像情報）に初期と足した物の差が無い → 同じ形と色を付ける
//  - 開発者の小窓の「共有の置き場（更新の置き場の shared）」が分かりにくい → 言い換える
//
// 1 回目の採点（2026-10-27-pin-defaults.json。1 位 P4 75.2 点で合格点に届かず）から:
//  - P4 の置き場と言葉の区切り（「足した物」）は効いた。が、区切りが帯の札だけで、表の行とデータ項目の窓では色だけ（−2）
//  - P2 の形の差（輪郭＝初期・塗り＝足した物）と、札のすぐ下の吹き出し・窓の見出しの凡例は効いた
//  - 開発者の所: メニューにすると初期化が 1 手増える（−2）。窓の中だけだと探す。誰にでも見えるボタンは開発者用と分からない
//  - 小さな印（10.5px の「初」・🔒）は読みにくい（−3）。札の中で確かめると並びが動く（−3）
//
// 今の困りごと（ui-check.mjs の lot-1728 を見て）:
//  1. 表示項目は全部同じクリーム色の札・行。初期の項目（アプリや開発者が決めた物）と自分で足した物の見分けが付かない
//  2. 札の × は確かめずにすぐ外す。初期の項目を外しても、何が起きたか・どう戻すかが出ない
//  3. 「表示設定を初期化」が何に戻すのか（アプリの初期値か、開発者が決めた初期値か）が画面のどこにも無い。開発者が初期値を決める所も無い
// 案の方向: 見分け（色・輪郭・印・置き場）× 警告（中央の小窓・札の下の吹き出し・札の中・下の帯）× 開発者の所（見出しの小窓・データ項目の窓）
// 見本の作り: 初期の項目は id が d_ で始まる（試験のロットには開発者の初期値が無い）。足した物は p_。属性で色を付けるので描き直しても残る

const INI = (s) => `${s}[data-pid^="d_"]`;
const ADD = (s) => `${s}[data-pid^="p_"]`;

// 撮る前に、自分で足した表示項目を 3 つ置く（サマリ・画像表示・ロット情報）
export const SETUP = `return (async () => {
  const have = await (await fetch("/api/pins")).json();
  if (have.some((p) => p.id.startsWith("p_"))) return;
  const add = (b) => fetch("/api/pins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  await add({ scope: "lot", place: "summary", label: "画像数", file: "dat:INSP_INFO", key: "image_total_cnt" });
  await add({ scope: "image", place: "card", label: "幅(mm)", file: "dat:DETECT_INFO", key: "width_mm" });
  await add({ scope: "lot", place: "lot", label: "検査長", file: "dat:INSP_INFO", key: "insp_end_y" });
})()`;

export const STATES = {
  lot: "",
  items: `document.getElementById("btnSources").click(); window.__sep && window.__sep(); window.__tags && window.__tags();`,
  warn: `document.getElementById("srcClose").click(); window.__warn && window.__warn();`,
  dev: `window.__unwarn && window.__unwarn(); window.__dev && window.__dev(); window.__sep && window.__sep();`,
};

// 色: 初期＝落ち着いた藍（決まっている・土台）、足した物＝今の黄（自分の付箋）
const COLOR_INI = `
${INI(".chip")}{background:#e9eff8;border-color:#b7c6dc;color:#1e3a5f}${INI(".chip")} .cl{color:#1e3a5f}
${INI("table.kv tr.pinned")} td{background:#eef3fa}${INI("table.kv tr.pinned")} td.k{color:#1e3a5f}`;
// 中央の小窓（警告）
const DLG_CSS = `.pw-mask{position:fixed;inset:0;background:rgba(15,23,42,.35);z-index:90;display:grid;place-items:center}
.pw-dlg{width:440px;background:#fff;border-radius:10px;box-shadow:0 20px 50px rgba(0,0,0,.3);padding:18px 20px;font-size:13px}
.pw-dlg h3{margin:0 0 8px;font-size:15px;display:flex;gap:8px;align-items:center}.pw-dlg h3 i{font-style:normal;color:#b45309;font-size:18px}
.pw-dlg p{margin:4px 0;color:#374151;line-height:1.6}.pw-dlg .pw-b{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
.pw-dlg button{padding:5px 14px}.pw-dlg .pw-go{background:#c62828;border-color:#c62828;color:#fff}.pw-dlg .pw-no{background:var(--acc);border-color:var(--acc);color:#fff}`;
const dlg = (extra = "") => `<div class="pw-mask" id="pwWarn"><div class="pw-dlg" role="alertdialog"><h3><i>⚠</i>初期の表示項目「材質」を外しますか</h3>
<p>「材質」は、はじめから置かれている項目（初期の表示項目）です。外すと、この PC のサマリから消えます。</p>
<p class="sub">戻すときは「データ項目」で置き直すか、「表示設定を初期化」を押します。</p>${extra}
<div class="pw-b"><button class="pw-go">外す</button><button class="pw-no">やめる</button></div></div></div>`;
const warnInsert = (html) => ["script", `window.__warn = () => document.body.insertAdjacentHTML("beforeend", ${JSON.stringify(html)});
  window.__unwarn = () => document.querySelectorAll("#pwWarn").forEach((x) => x.remove());`];


// 形: 初期＝白地に藍の輪郭（決まっている土台）、足した物＝今の黄の塗り（自分の付箋）。表の行は左の線の色と地で同じ差
const SHAPE = `
${INI(".chip")}{background:#fff;border:1.5px solid #8ea3c2;color:#1e3a5f}${INI(".chip")} .cl{color:#1e3a5f}
${INI("table.kv tr.pinned")} td{background:#fff}${INI("table.kv tr.pinned")} td.k{color:#1e3a5f;box-shadow:inset 3px 0 0 #8ea3c2}
${ADD("table.kv tr.pinned")} td.k{box-shadow:inset 3px 0 0 #e0a83a}`;
// 区切り: 帯の中・表の中・データ項目の窓の表示先で、初期の後ろに「足した物」と書いた区切りを置く（並びは初期→足した物）
const SEP_CSS = `.pd-sep{display:inline-flex;align-items:center;gap:4px;color:#8a5a00;font-size:11.5px;font-weight:700;border-left:1.5px dashed #c9a24a;padding-left:7px;margin-left:3px}
tr.pd-sepr td{font-size:11.5px;font-weight:700;color:#8a5a00;padding-top:5px!important;border-top:1.5px dashed #c9a24a;background:#fff!important}`;
const SEP = ["script", `window.__sep = () => { document.querySelectorAll(".pd-sep,.pd-sepr").forEach((x) => x.remove());
  for (const box of document.querySelectorAll(".summary,.slot,.chips,.dchips .pins,.f-none")) { const first = box.querySelector('.chip[data-pid^="p_"]');
    if (first) first.insertAdjacentHTML("beforebegin", '<span class="pd-sep">足した物</span>'); }
  for (const tb of document.querySelectorAll("table.kv")) { const adds = [...tb.querySelectorAll('tr.pinned[data-pid^="p_"]')];
    const lastPin = [...tb.querySelectorAll("tr.pinned")].filter((r) => !adds.includes(r)).pop(); if (lastPin) adds.reverse().forEach((r) => lastPin.after(r));
    const first = tb.querySelector('tr.pinned[data-pid^="p_"]');
    if (first) first.insertAdjacentHTML("beforebegin", '<tr class="pd-sepr"><td colspan="3">足した物</td></tr>'); } };
  window.__sep();`];
// 札のすぐ下の吹き出し（警告）
const POP_CSS = `.pw-pop{position:fixed;z-index:90;width:320px;background:#fff;border:1px solid #e3b25a;border-radius:8px;box-shadow:0 10px 26px rgba(0,0,0,.22);padding:10px 12px;font-size:12.5px}
.pw-pop:before{content:"";position:absolute;left:24px;top:-7px;width:12px;height:12px;background:#fff;border-left:1px solid #e3b25a;border-top:1px solid #e3b25a;transform:rotate(45deg)}
.pw-pop b{color:#8a5a00;font-size:13px}.pw-pop p{margin:4px 0 8px;color:#374151;line-height:1.6}.pw-pop .pw-b{display:flex;gap:6px;justify-content:flex-end}
.pw-pop .pw-go{background:#c62828;border-color:#c62828;color:#fff}`;
const POP = (body) => ["script", `window.__warn = () => { const c = document.querySelector('.chip[data-pid="d_s_mat"]').getBoundingClientRect();
  document.body.insertAdjacentHTML("beforeend", '<div class="pw-pop" id="pwWarn" style="left:' + (c.left - 10) + 'px;top:' + (c.bottom + 8) + 'px">${body}<div class="pw-b"><button>やめる</button><button class="pw-go">外す</button></div></div>'); };
  window.__unwarn = () => document.querySelectorAll("#pwWarn").forEach((x) => x.remove());`];
const POP_BODY = `<b>⚠ 初期の表示項目です</b><p>「材質」を外すと、この PC のサマリから消えます。戻すときは「表示設定を初期化」か、データ項目で置き直します。</p>`;
// 開発者だけに見える見出しのボタン「初期値（開発者）」→ 小窓（いまの初期値・この PC の数・決める／やめる）
const DEVWIN_CSS = `.pd-devbtn{border-color:#8a6d2e!important;color:#ffd27a!important}
.pd-win{position:fixed;right:12px;top:40px;z-index:80;width:430px;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 14px 40px rgba(0,0,0,.25);padding:14px 16px;font-size:13px}
.pd-win h4{margin:0 0 4px;font-size:14px}.pd-win dl{display:grid;grid-template-columns:auto 1fr;gap:5px 12px;margin:10px 0;font-size:12.5px}.pd-win dt{color:var(--sub)}
.pd-win .pd-b{display:flex;gap:8px;justify-content:flex-end;margin-top:10px}.pd-win .pd-note{margin-top:8px;color:var(--sub);font-size:12px}`;
const DEVBTN = ["script", `document.getElementById("btnReset").insertAdjacentHTML("beforebegin", '<button type="button" class="ghost pd-devbtn" title="開発者だけに出ます">初期値を決める（開発者）</button>');
  window.__dev = () => document.body.insertAdjacentHTML("beforeend", '<div class="pd-win"><h4>表示の初期値（開発者）</h4><div class="sub">新しい PC と「表示設定を初期化」が使う表示項目です。各 PC で変えた表示はそのまま残ります。</div>'
    + '<dl><dt>いまの初期値</dt><dd><b>アプリの初期値</b>（34 項目）</dd><dt>この PC の表示</dt><dd>初期 34・足した物 3</dd></dl>'
    + '<div class="pd-b"><button disabled>アプリの初期値に戻す</button><button class="primary">いまの表示を初期値にする</button></div><div class="pd-note">決めた初期値は配布の置き場に置かれ、どの PC の「表示設定を初期化」にも使われます。</div></div>');`];


// 角の形: 初期＝角の少し丸い四角（5px）、足した物＝丸い札
const CORNER = `${INI(".chip")}{border-radius:5px}`;
// データ項目の窓の中央の一覧の「置き先の札」: 初期の項目が置かれている先は初期の形、足した物は黄の丸
const TAGS_CSS = `#srcRows .dpl{background:#fff;border:1.5px solid #8ea3c2;color:#1e3a5f;border-radius:5px}#srcRows .dpl.pd-add{background:var(--pinbg);border:1px solid #ecd9a8;color:#8a5a00;border-radius:10px}`;
const TAGS = ["script", `window.__tags = () => { const row = document.querySelector('#srcRows tr.src[data-key="width_mm"]'); if (!row) return;
  const t = [...row.querySelectorAll(".dpl")].find((x) => x.textContent.includes("画像表示")); if (t) t.classList.add("pd-add"); };`];
const DLG_CSS3 = `.pw-mask{position:fixed;inset:0;background:rgba(15,23,42,.35);z-index:90;display:grid;place-items:center}
.pw-dlg{width:460px;background:#fff;border-radius:10px;box-shadow:0 20px 50px rgba(0,0,0,.3);padding:18px 20px;font-size:13px}
.pw-dlg h3{margin:0 0 8px;font-size:15px}.pw-dlg p{margin:6px 0;color:#374151;line-height:1.6}.pw-dlg .pw-b{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
.pw-dlg .pw-go{background:#c62828;border-color:#c62828;color:#fff}.pw-dlg .pw-chip{display:inline-block;border:1.5px solid #8ea3c2;border-radius:5px;padding:0 8px;color:#1e3a5f;font-weight:700}`;
const DLG3 = ["script", `window.__warn = () => document.body.insertAdjacentHTML("beforeend", '<div class="pw-mask" id="pwWarn"><div class="pw-dlg" role="alertdialog"><h3>⚠ 初期の表示項目を外しますか</h3><p><span class="pw-chip">材質</span> はアプリ（開発者）が決めた初期の項目です。外すと、この PC のサマリから消えます。</p><p class="sub">戻すときは「表示設定を初期化」か、データ項目で置き直します。</p><div class="pw-b"><button>やめる</button><button class="pw-go">外す</button></div></div></div>');
  window.__unwarn = () => document.querySelectorAll("#pwWarn").forEach((x) => x.remove());`];

export const PROPOSALS = [
  {
    key: "R1", name: "（Q5 の直し）角の形・輪郭と塗り・区切り「足した物」を帯・表・窓・中央の一覧の札にそろえる＋札の下の吹き出し＋開発者だけの「初期値を決める（開発者）」",
    css: SHAPE + CORNER + SEP_CSS + POP_CSS + DEVWIN_CSS + TAGS_CSS,
    ops: [SEP, POP(POP_BODY), DEVBTN, TAGS],
  },
  {
    key: "R2", name: "（Q1 の直し）丸い札のまま輪郭＝初期・塗り＝足した物＋区切りを帯・表・窓・中央の一覧にそろえる＋吹き出し＋開発者のボタン",
    css: SHAPE + SEP_CSS + POP_CSS + DEVWIN_CSS + TAGS_CSS.replace(/border-radius:5px/g, "border-radius:10px"),
    ops: [SEP, POP(POP_BODY), DEVBTN, TAGS],
  },
  {
    key: "R3", name: "（新）R1 の見分け方＋警告は中央の小窓（初期の札の形の見本・押せない）。外すかどうかを画面の真ん中で 1 度だけ決める",
    css: SHAPE + CORNER + SEP_CSS + DEVWIN_CSS + TAGS_CSS + DLG_CSS3,
    ops: [SEP, DLG3, DEVBTN, TAGS],
  },
  {
    key: "R4", name: "（新）R1＋サマリの帯の頭に小さな凡例（□ 初期・○ 足した物）を常に出し、データ項目の窓の表示先の見出しにも同じ凡例",
    css: SHAPE + CORNER + SEP_CSS + POP_CSS + DEVWIN_CSS + TAGS_CSS + `
.pd-leg{display:inline-flex;gap:5px;align-items:center;font-size:11.5px;color:var(--sub);margin-right:4px}.pd-leg i{font-style:normal;padding:0 6px;font-size:11.5px}
.pd-leg .a{border:1.5px solid #8ea3c2;color:#1e3a5f;background:#fff;border-radius:5px}.pd-leg .b{background:var(--pinbg);border:1px solid #ecd9a8;color:#8a5a00;border-radius:10px}`,
    ops: [SEP, POP(POP_BODY), DEVBTN, TAGS, ["script", `
      const lab = document.querySelector("#summary .dzl"); if (lab) lab.insertAdjacentHTML("afterend", '<span class="pd-leg"><i class="a">初期</i><i class="b">足した物</i></span>');
      const pt = document.querySelector("#srcModal .dpt"); if (pt) pt.insertAdjacentHTML("beforeend", ' <span class="pd-leg"><i class="a">初期</i><i class="b">足した物</i></span>');`]],
  },
  {
    key: "R5", name: "（新）R1＋足した物の区切りに「この PC で足した物」と書き、帯の × に触れると初期の札は「初期の項目を外す…」、足した札は「外す」と言葉で出す（吹き出しの前触れ）",
    css: SHAPE + CORNER + SEP_CSS + POP_CSS + DEVWIN_CSS + TAGS_CSS + `.pd-tip{position:fixed;z-index:85;background:#1f2937;color:#fff;font-size:12px;border-radius:4px;padding:3px 8px}`,
    ops: [SEP, POP(POP_BODY), DEVBTN, TAGS, ["script", `const sep0 = window.__sep; window.__sep = () => { sep0(); document.querySelectorAll(".pd-sep,.pd-sepr td").forEach((x) => { x.textContent = "この PC で足した物"; }); }; window.__sep();
      const x = document.querySelector('.chip[data-pid="d_s_tmp"] .x').getBoundingClientRect();
      document.body.insertAdjacentHTML("beforeend", '<div class="pd-tip" style="left:' + (x.left - 30) + 'px;top:' + (x.bottom + 6) + 'px">初期の項目を外す…</div>');`]],
  },
];
