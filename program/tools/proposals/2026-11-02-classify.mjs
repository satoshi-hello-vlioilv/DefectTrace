// 画像の仕分け（グループを作り、見本の画像を 3 枚以上ドラッグ＆ドロップで登録 → データと画像の特徴から条件を割り出し、ほかの画像を振り分ける）の案（1 回目）:
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-11-02-classify.mjs
//
// 今の困りごと（ui-check の lot-1728・lot-1280 を見て）:
//  1. 画像一覧のカードは選ぶ・拡大するだけで、印を付ける・まとめる手段が無い（似た欠陥を集めるには 1 枚ずつ目で探す）
//  2. 絞り方は「フィルタ」（欠陥データの項目の条件を人が書く）だけ。画像の見た目（暗さ・形・大きさ）では絞れず、条件を考えるのも人
//  3. 右の欄は 画像情報・MAP・ロット情報 で縦に埋まっている（1280 では MAP の途中まで）。新しい箱を足すと下へ押し出される
// 案の方向: 置き場（右の欄の箱・見方の切り替えの盤面・フィルタの帯・ドラッグ中の受け皿・専用の窓）× 結果の見せ方（カードの札・グループ順の見出し）
// 例: グループ「黒点」（見本 3 枚・当てはまる 7 枚）・「スジ」（見本 2 枚: あと 1 枚）。条件は「暗さ・面積・縦横比」の範囲（作るときは裏が見本から割り出す）

const G = [
  { n: "黒点", c: "#c62828", ex: 3, hit: 7, rule: "暗さ 35〜48 ・ 面積 2.2〜2.6 mm² ・ 縦横比 0.9〜1.1" },
  { n: "スジ", c: "#1e5aa8", ex: 2, hit: 0, rule: "見本をあと 1 枚（3 枚で条件を割り出します）" },
];
// カードに札（グループの色と名前）。先頭からいくつかのカードへ
const TAGS = (style) => ["script", `window.__tags = () => { const ths = [...document.querySelectorAll("#grid .th")].slice(0, 12);
  ths.forEach((t, i) => { if (t.querySelector(".ctag")) return; const g = [0, 2, 3, 6, 9, 10, 11].includes(i) ? ${JSON.stringify(G[0])} : (i === 4 ? ${JSON.stringify(G[1])} : null); if (!g) return;
    const ex = [0, 2, 6].includes(i) || i === 4;
    t.insertAdjacentHTML("afterbegin", ${JSON.stringify(style)}.replace("{c}", g.c).replace("{n}", g.n + (ex ? "・見本" : "")).replace("{s}", ex ? "solid" : "dashed")); }); };`];
const AFTER = `return (async () => { await new Promise((r) => setTimeout(r, 300)); if (window.__tags) window.__tags(); if (window.__more) await window.__more(); })()`;
export const STATES = { lot: AFTER };

const BASE = `.ctag{position:absolute;z-index:2;right:8px;top:4px;font:700 11px/1.5 system-ui,sans-serif;color:#fff;background:{c};border-radius:4px;padding:0 6px;pointer-events:none}
.cls-g{display:grid;grid-template-columns:auto 1fr auto;gap:2px 8px;align-items:center;border:1px solid var(--line);border-radius:6px;padding:6px 8px;margin:6px 0;background:var(--pane)}
.cls-g .dot{width:12px;height:12px;border-radius:3px}.cls-g b{font-size:13px}.cls-g .n{font:12px Consolas,monospace;color:var(--sub);text-align:right}
.cls-g .rule{grid-column:1/-1;font-size:12px;color:var(--sub)}.cls-g .ex{grid-column:1/-1;display:flex;gap:4px}.cls-g .ex i{width:30px;height:24px;background:#9aa3ad url() center/cover;border-radius:3px;display:inline-block}
.cls-g.drop{outline:2px dashed var(--acc);outline-offset:2px;background:var(--accbg)}
.cls-add{font-size:12px;color:var(--acc);border:1px dashed var(--acc);border-radius:6px;padding:4px 8px;text-align:center}`;
const tag = (css) => `<span class="ctag" style="background:{c};border:1px {s} #fff">{n}</span>`;
const exImgs = `<span class="ex"><i></i><i></i><i></i></span>`;
const groupRows = (drop) => G.map((g, i) => `<div class="cls-g${drop && i === 1 ? " drop" : ""}"><span class="dot" style="background:${g.c}"></span><b>${g.n}</b><span class="n">見本 ${g.ex}/3 ・ ${g.hit} 枚</span>${exImgs}<span class="rule">${g.rule}</span></div>`).join("");

export const PROPOSALS = [
  {
    key: "A", name: "右の欄の先頭に「仕分け」の箱（グループの行＝ドロップ先・見本の小さな画像・割り出した条件）。カードの左上に色の札（見本は実線・当てはまるは点線）",
    css: BASE,
    ops: [TAGS(tag()),
      ["insert", `<details class="box" open><summary>仕分け <span class="sub">カードをグループへドラッグ（3 枚で条件を割り出す）</span></summary>${groupRows(true)}<div class="cls-add">＋ グループを作る</div></details>`, "afterbegin", "#infoPane"]],
  },
  {
    key: "B", name: "見方の切り替えに「仕分け」（画像一覧・転写候補・ピッチ候補・仕分け）: 盤面＝グループごとの列（上に見本のドロップ先、下に当てはまった画像を確からしさ順）。左端は未分類",
    css: BASE + `.board{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:8px;flex:1;overflow:auto}.bcol{background:var(--pane);border:1px solid var(--line);border-radius:6px;padding:8px;display:flex;flex-direction:column;gap:6px;min-width:0}
.bcol h4{margin:0;font-size:14px;display:flex;gap:6px;align-items:center}.bcol .ex2{border:2px dashed var(--line);border-radius:6px;padding:6px;display:flex;gap:6px;flex-wrap:wrap;min-height:70px}.bcol .ex2 i,.bcol .hits i{width:88px;height:66px;background:#9aa3ad;border-radius:3px;display:inline-block}
.bcol .hits{display:flex;gap:6px;flex-wrap:wrap}.bcol .rule{font-size:12px;color:var(--sub)}.bcol .lab{font-size:12px;color:var(--sub)}`,
    ops: [
      ["insert", `<button type="button" class="on">仕分け <span class="cnt0">2</span></button>`, "beforeend", "#viewSeg"],
      ["script", `document.querySelector('#viewSeg [data-v="grid"]').classList.remove("on"); document.getElementById("grid").hidden = true; document.getElementById("fBar").hidden = true;
        const imgs = (n) => Array.from({ length: n }, () => "<i></i>").join("");
        document.getElementById("grid").insertAdjacentHTML("afterend", '<div class="board"><div class="bcol"><h4>未分類 <span class="sub">15 枚</span></h4><div class="lab">ここからグループの列へドラッグ</div><div class="hits">' + imgs(9) + '</div></div>' +
          ${JSON.stringify(G)}.map((g) => '<div class="bcol"><h4><span style="width:12px;height:12px;border-radius:3px;background:' + g.c + '"></span>' + g.n + ' <span class="sub">見本 ' + g.ex + '/3 ・ ' + g.hit + ' 枚</span></h4><div class="lab">見本（ここへドラッグ）</div><div class="ex2">' + imgs(g.ex) + '</div><div class="rule">' + g.rule + '</div><div class="lab">当てはまる（確からしい順）</div><div class="hits">' + imgs(Math.min(g.hit, 6)) + '</div></div>').join("") + '</div>');`]],
  },
  {
    key: "C", name: "フィルタの帯に「仕分け」の札（色・名前・枚数）を並べる。カードを札へドラッグで見本に、札を押すと一覧をその組に絞る（今のフィルタと同じ帯・同じ押し方）",
    css: BASE + `.cls-chip{white-space:nowrap;display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:14px;padding:2px 10px;font-size:13px;background:var(--pane)}.cls-chip .dot{width:10px;height:10px;border-radius:50%}.cls-chip.on{border-color:var(--acc);background:var(--accbg)}.cls-chip.drop{outline:2px dashed var(--acc)}.cls-lab{font-size:12px;color:var(--sub);margin-left:12px}`,
    ops: [TAGS(tag()),
      ["insert", `<span class="cls-lab">仕分け</span>${G.map((g, i) => `<span class="cls-chip${i === 0 ? " on" : ""}${i === 1 ? " drop" : ""}" title="${g.rule}"><span class="dot" style="background:${g.c}"></span>${g.n}<b>${g.hit || "見本 " + g.ex + "/3"}</b></span>`).join("")}<span class="cls-chip" style="border-style:dashed;color:var(--acc)">＋</span>`, "beforebegin", "#fCount"]],
  },
  {
    key: "D", name: "カードをドラッグしている間だけ、一覧の下に受け皿（グループ・＋新しいグループ）が出る。普段は隠れて画面を取らない。カードに札",
    css: BASE + `.tray{position:absolute;left:8px;right:8px;bottom:8px;display:flex;gap:8px;padding:10px;background:rgba(255,255,255,.96);border:1px solid var(--line);border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.18);z-index:5}#center{position:relative}
.tray .tg{flex:1;border:2px dashed var(--line);border-radius:8px;padding:8px;display:flex;flex-direction:column;gap:2px;font-size:13px}.tray .tg.on{border-color:var(--acc);background:var(--accbg)}.tray .tg small{color:var(--sub)}`,
    ops: [TAGS(tag()),
      ["script", `document.getElementById("center").insertAdjacentHTML("beforeend", '<div class="tray">' + ${JSON.stringify(G)}.map((g, i) => '<div class="tg' + (i === 1 ? ' on' : '') + '"><b style="color:' + g.c + '">■ ' + g.n + '</b><small>見本 ' + g.ex + '/3 ・ ' + g.hit + ' 枚</small><small>' + g.rule + '</small></div>').join("") + '<div class="tg"><b>＋ 新しいグループ</b><small>ここへ落とすと作る</small></div></div>');
        document.querySelector("#grid .th:nth-child(6)")?.setAttribute("style", "opacity:.45;outline:2px solid var(--acc)");`]],
  },
  {
    key: "E", name: "専用の窓「仕分け」（ツールバーのボタン）: 左にグループ、中に見本（ドロップ先）と特徴の比べ（見本とロット全体の分布の帯）、右に割り出した条件（直せる）と当てはまる画像",
    css: BASE + `.cmod{position:fixed;inset:5vh 4vw;background:var(--pane);border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.3);z-index:20;display:grid;grid-template-columns:220px 1fr 300px;grid-template-rows:auto 1fr;overflow:hidden}
.cmod>header{grid-column:1/-1;background:var(--pane);color:var(--txt);height:auto;display:flex;gap:8px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--line)}.cmod>div{padding:10px;overflow:auto;border-right:1px solid var(--line2)}
.feat{display:grid;grid-template-columns:90px 1fr 70px;gap:4px 8px;align-items:center;font-size:12px}.feat .bar{position:relative;height:14px;background:#eef1f4;border-radius:3px}.feat .bar span{position:absolute;top:0;bottom:0;border-radius:3px}
.ex3{display:flex;gap:6px;flex-wrap:wrap;border:2px dashed var(--acc);border-radius:8px;padding:8px;margin-bottom:10px}.ex3 i{width:90px;height:68px;background:#9aa3ad;border-radius:3px}
.cmask{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:19}`,
    ops: [
      ["insert", `<button type="button" class="ghost" style="margin-left:8px">◈ 仕分け</button>`, "beforeend", ".toolbar"],
      ["script", `const feats = [["暗さ", 18, 30, "35〜48"], ["面積(mm²)", 40, 12, "2.2〜2.6"], ["縦横比", 45, 10, "0.9〜1.1"], ["幅方向(mm)", 5, 90, "（使わない）"]];
        document.body.insertAdjacentHTML("beforeend", '<div class="cmask"></div><div class="cmod"><header><b>仕分け</b><span class="sub">グループを作り、見本を 3 枚以上ドラッグ → 見本に共通する特徴から条件を割り出します</span><span class="spacer"></span><button type="button" class="primary" style="color:#fff;background:var(--acc)">閉じる</button></header>' +
          '<div>' + ${JSON.stringify(G)}.map((g, i) => '<div class="cls-g" style="' + (i === 0 ? 'outline:2px solid var(--acc)' : '') + '"><span class="dot" style="background:' + g.c + '"></span><b>' + g.n + '</b><span class="n">' + g.hit + ' 枚</span></div>').join("") + '<div class="cls-add">＋ グループを作る</div></div>' +
          '<div><b>黒点の見本（3 枚）</b><div class="ex3"><i></i><i></i><i></i></div><b>特徴: 見本（濃い）とロット全体（薄い）</b><div class="feat" style="margin-top:6px">' + feats.map((f) => '<span>' + f[0] + '</span><span class="bar"><span style="left:0;width:100%;background:#dfe5ec"></span><span style="left:' + f[1] + '%;width:' + f[2] + '%;background:#c62828;opacity:.8"></span></span><span>' + f[3] + '</span>').join("") + '</div></div>' +
          '<div><b>割り出した条件</b><div class="sub" style="margin:4px 0 8px">暗さ 35〜48 かつ 面積 2.2〜2.6 mm² かつ 縦横比 0.9〜1.1</div><b>当てはまる 7 枚</b><div class="ex3" style="border-style:solid;border-color:var(--line)"><i></i><i></i><i></i><i></i></div></div></div>');`]],
  },
  {
    key: "F", name: "A＋一覧をグループの見出しで並べ替え（「黒点 7 枚」「スジ 見本 2/3」「未分類 15 枚」の見出しの下にカード）。CAB の見出しと同じ形",
    css: BASE + `.gsep{width:100%;display:flex;gap:8px;align-items:center;font-weight:700;font-size:13px;padding:4px 2px;border-bottom:2px solid var(--line)}`,
    ops: [TAGS(tag()),
      ["insert", `<details class="box" open><summary>仕分け <span class="sub">カードをグループへドラッグ（3 枚で条件を割り出す）</span></summary>${groupRows(false)}<div class="cls-add">＋ グループを作る</div></details>`, "afterbegin", "#infoPane"],
      ["script", `window.__more = async () => { const g = document.getElementById("grid"); const ths = [...g.querySelectorAll(".th")];
        g.querySelectorAll(".cabsep,.ph").forEach((x) => x.remove());
        const tagged = ths.filter((t) => t.querySelector(".ctag") && !/スジ/.test(t.textContent)), stj = ths.filter((t) => /スジ/.test(t.querySelector(".ctag")?.textContent || "")), rest = ths.filter((t) => !t.querySelector(".ctag"));
        g.innerHTML = ""; g.insertAdjacentHTML("beforeend", '<div class="gsep"><span style="color:#c62828">■</span>黒点 <span class="sub">' + tagged.length + ' 枚</span></div>'); tagged.forEach((t) => g.append(t));
        g.insertAdjacentHTML("beforeend", '<div class="gsep"><span style="color:#1e5aa8">■</span>スジ <span class="sub">見本 2/3</span></div>'); stj.forEach((t) => g.append(t));
        g.insertAdjacentHTML("beforeend", '<div class="gsep">未分類 <span class="sub">' + rest.length + ' 枚</span></div>'); rest.forEach((t) => g.append(t)); };`]],
  },
];
