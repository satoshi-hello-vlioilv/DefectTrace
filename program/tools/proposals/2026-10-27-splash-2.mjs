// 起動画面（desktop/splash/index.html）の案（2 回目）。
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-10-27-splash-2.mjs
//
// 1 回目の採点（2026-10-27-splash.json。1 位 S5 カメラと光 74.0・2 位 S1 流れる板と走査線 73.1。合格点に届かず）から:
//  - S5 のカメラと光は「表面検査計」と一目で分かる。S1 の済んだ区間（検査済みの面と欠陥の印）は段の様子がいちばん分かる → 合わせる
//  - 済んだ光といまの光の差が明るさだけ → 済んだ段に ✓ の形、いまの段に走査線の動き
//  - 見本の崩れ: 元の .seg path{fill:none} で ▲・★ と ▼ が消えた（塗りは style で書く）。S4 は <defs> が初めの子で段が 1 つずれた（defs は後ろへ）
//  - 薄い字（詳しい文 .55・まだの段 .5）のコントラストが 4.5 未満 → .75 に。2 / 3 と詳しい文を 1 行に
//
// 今の困りごと（今の起動画面を start・mid・fail × 1728・1536・1280 で撮って見て）:
//  1. 進み具合が「周期の山の線」、下の大きな飾りも同じ山の模様（移した元 LotScope の絵柄）。表面検査（流れる板・走査・欠陥・カメラ）に結び付く物が無い
//  2. 画面の 6 割が空。名乗りと進み具合が中央に小さく、段（3 段）が何か は文字だけで、絵からは読めない
//  3. 下の飾りが画面の幅より 26px はみ出している（飾り）
// 案の方向: 絵柄（流れる板と走査線・欠陥の MAP・物差しの目盛り・検査画像のコマ・カメラと光）× 進み具合の見せ方（区間・地図が埋まる・頭が進む・コマが済む・光が灯る）
// 窓が呼ぶ splash.step の段（3 つ）は #seg の子の 3 つに wait・now・ok・warn・bad のクラスを付ける。案ごとに #seg の中身と #motif を描き替える

export const PAGE = "splash";
export const STATES = {
  start: ``,
  mid: `splash.step("program", "ok", "C:\\\\Users\\\\sato\\\\AppData\\\\Local\\\\DefectTrace\\\\app\\\\4.6.0\\\\program"); splash.step("update", "now", "新しい版が配られていないか確かめています…");`,
  fail: `splash.fail("配る版を取り込めません", "\\\\\\\\server\\\\share\\\\90_Releases\\\\DefectTrace\\\\versions\\\\4.6.0 に届きません（ネットワークの場所が見つかりません）");`,
};

// 共通: 進み具合の箱を広く、段の名前を絵の下に 3 つ並べる（いまの段を強く、済んだ段に ✓）
const BASE = `
.run{width:720px}.seg{width:720px;height:auto}
.legs{display:grid;grid-template-columns:repeat(3,1fr);margin-top:10px;font-size:13.5px;color:rgba(255,255,255,.72)}
.legs span{text-align:center}.legs span.now{color:#fff;font-weight:700}.legs span.ok{color:#7fd3c9}.legs span.ok:before{content:"✓ "}
.legs span.bad{color:#ff8a7a;font-weight:700}.legs span.warn{color:#e6a52e}
.motif{height:46vh;left:0;width:100%}
.seg>g{stroke:none!important;filter:none!important;animation:none!important}.seg path{stroke-width:1.5}
#stepTitle{display:none}
.run{display:grid;grid-template-columns:auto 1fr;column-gap:12px;align-items:baseline}.run>.seg,.run>.legs{grid-column:1/-1}
.step{margin-top:12px;font-size:13px;white-space:nowrap}.detail{margin-top:12px;opacity:.78;font-size:12.5px}`;
// 段の名前を絵の下にも出し、段の状態に合わせる（paint の後に合わせる）
const LEGS = `const run = document.querySelector(".run");
  run.querySelector(".seg").insertAdjacentHTML("afterend", '<div class="legs"><span>アプリの中身</span><span>新しい版</span><span>画面を開く</span></div>');
  const sync = () => [...document.querySelectorAll("#seg > *")].forEach((g, i) => { const l = document.querySelectorAll(".legs span")[i]; if (l) l.className = g.getAttribute("class") || ""; });
  new MutationObserver(sync).observe(document.getElementById("seg"), { attributes: true, subtree: true, attributeFilter: ["class"] }); sync();`;
// いまの段を描き替えたら、窓が付けたクラスを写す（描き替えの前の状態を残す）
const redraw = (viewBox, groups, motif) => `const seg = document.getElementById("seg"); const keep = [...seg.children].map((c) => c.getAttribute("class"));
  seg.setAttribute("viewBox", ${JSON.stringify(viewBox)}); seg.innerHTML = ${groups};
  [...seg.children].slice(0, 3).forEach((c, i) => c.setAttribute("class", keep[i] || "wait"));
  document.getElementById("motif").innerHTML = ${motif};`;

// 欠陥の点（印は画面と同じ: ● 穴 赤・▲ 汚れ 青・■ キズ 緑・★ 周期 橙）
const MARKS = `const mk = (k, x, y, s) => k === 0 ? '<circle cx="' + x + '" cy="' + y + '" r="' + s + '" style="fill:#e0412c"/>'
  : k === 1 ? '<path d="M' + x + ' ' + (y - s) + 'L' + (x + s) + ' ' + (y + s) + 'L' + (x - s) + ' ' + (y + s) + 'Z" style="fill:#4c8dff"/>'
  : k === 2 ? '<rect x="' + (x - s) + '" y="' + (y - s) + '" width="' + 2 * s + '" height="' + 2 * s + '" style="fill:#2fbf71"/>'
  : '<path d="M' + x + ' ' + (y - s) + 'L' + (x + s * .35) + ' ' + (y - s * .3) + 'L' + (x + s) + ' ' + (y - s * .2) + 'L' + (x + s * .5) + ' ' + (y + s * .3) + 'L' + (x + s * .6) + ' ' + (y + s) + 'L' + x + ' ' + (y + s * .6) + 'L' + (x - s * .6) + ' ' + (y + s) + 'L' + (x - s * .5) + ' ' + (y + s * .3) + 'L' + (x - s) + ' ' + (y - s * .2) + 'L' + (x - s * .35) + ' ' + (y - s * .3) + 'Z" style="fill:#e6a52e"/>';
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;`;


// 板の上のカメラ 3 台（段ごと）。済んだ段: 板のその区間が検査済みの色＋欠陥の印・カメラに ✓。いまの段: 光が灯り、板の上を走査線が走る。まだ: 灰のカメラ・光なし
const CAMS = (w, h) => `[0, 1, 2].map((i) => { const W = ${w} / 3, x = i * W, cx = x + W / 2, top = 10, sy = ${h} - 34; let d = ""; for (let k = 0; k < 6; k++) d += mk(k % 4, x + 18 + rnd() * (W - 36), sy + 6 + rnd() * 14, 3.4);
  return '<g><path class="cone" d="M' + (cx - 7) + ' ' + (top + 30) + ' L' + (x + 14) + ' ' + sy + ' L' + (x + W - 14) + ' ' + sy + ' L' + (cx + 7) + ' ' + (top + 30) + 'Z"/>'
    + '<rect class="sec" x="' + (x + 6) + '" y="' + sy + '" width="' + (W - 12) + '" height="26" rx="2"/><g class="dots">' + d + '</g>'
    + '<rect class="beam" x="' + (x + 8) + '" y="' + (sy - 2) + '" width="3" height="30" style="fill:#e8fffb"/>'
    + '<rect class="cam" x="' + (cx - 28) + '" y="' + top + '" width="56" height="30" rx="5"/><circle class="lamp" cx="' + cx + '" cy="' + (top + 15) + '" r="6"/>'
    + '<path class="chk" d="M' + (cx - 6) + ' ' + (top + 15) + ' l4 4 l8 -9" /></g>'; }).join("")`;
const CAM_CSS = (W) => `
.seg .cone{fill:rgba(127,211,201,.0)}.seg .cam{fill:#2f4258;stroke:rgba(255,255,255,.35);stroke-width:1}.seg .lamp{fill:rgba(255,255,255,.22)}
.seg .sec{fill:rgba(255,255,255,.06);stroke:rgba(255,255,255,.2);stroke-width:1}.seg g .dots{opacity:0}.seg .beam{opacity:0}.seg .chk{opacity:0;fill:none!important;stroke:#0f2a2a;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
.seg g.ok .cam{fill:#7fd3c9;stroke:#7fd3c9}.seg g.ok .lamp{opacity:0}.seg g.ok .chk{opacity:1}.seg g.ok .sec{fill:rgba(127,211,201,.2);stroke:#7fd3c9}.seg g.ok .dots{opacity:1}.seg g.ok .cone{fill:rgba(127,211,201,.08)}
.seg g.now .cam{fill:#3b5d7a;stroke:#bff3ec}.seg g.now .lamp{fill:#bff3ec}.seg g.now .cone{fill:rgba(127,211,201,.26);animation:breathe2 1.4s ease-in-out infinite}
.seg g.now .sec{stroke:#bff3ec}.seg g.now .beam{opacity:1;animation:sweep 1.5s linear infinite}
.seg g.warn .cam{fill:#e6a52e}.seg g.bad .cam{fill:#ff8a7a;stroke:#ff8a7a}.seg g.bad .sec{stroke:#ff8a7a}
@keyframes breathe2{0%,100%{opacity:.4}50%{opacity:1}}@keyframes sweep{from{transform:translateX(0)}to{transform:translateX(${W}px)}}
.motif .roll{fill:none;stroke:rgba(127,211,201,.08);stroke-width:3}.motif .strip{fill:rgba(127,211,201,.04)}`;
const ROLLS = `'<rect class="strip" x="0" y="330" width="1600" height="14"/>' + [100, 420, 740, 1060, 1380].map((x) => '<circle class="roll" cx="' + x + '" cy="372" r="26"/>').join("")`;

export const PROPOSALS = [
  {
    key: "T1", name: "（S5＋S1）板の上のカメラ 3 台: 済んだ段は板が検査済みの色と欠陥の印・カメラに ✓、いまの段は光が灯り板の上を走査線が走る",
    css: BASE + CAM_CSS(200),
    ops: [["script", MARKS + redraw("0 0 720 140", CAMS(720, 140), ROLLS) + LEGS]],
  },
  {
    key: "T2", name: "（S1 改）流れる板の 3 区間（済んだ区間は検査済みの色・欠陥の印・✓）、いまの区間の上に 1 台のカメラと光が乗り、走査線が走る",
    css: BASE + CAM_CSS(200) + `.seg .cam,.seg .lamp,.seg .chk,.seg .cone,.seg g.ok .chk{opacity:0}.seg g.now .cam,.seg g.now .lamp,.seg g.now .cone{opacity:1}
.seg .tick{opacity:0;fill:#7fd3c9}.seg g.ok .tick{opacity:1}`,
    ops: [["script", MARKS + redraw("0 0 720 140", CAMS(720, 140) + ` + [0, 1, 2].map((i) => '<text class="tick" x="' + (i * 240 + 212) + '" y="124" style="font:700 15px sans-serif;fill:#7fd3c9">✓</text>').join("")`, ROLLS)
      + `document.querySelectorAll("#seg .tick").forEach((t, i) => document.querySelectorAll("#seg > g")[i].append(t));` + LEGS]],
  },
  {
    key: "T3", name: "（新）検査ラインの全景: 左の巻き（コイル）から右の巻きへ板が流れ、途中の 3 台のカメラが段ごとに灯る（済んだ所は板が検査済みの色）",
    css: BASE + CAM_CSS(200) + `.seg .coil{fill:none;stroke:rgba(255,255,255,.35);stroke-width:1.5}`,
    ops: [["script", MARKS + redraw("-60 0 800 150", CAMS(680, 150) + ` + [30, 22, 14].map((r) => '<circle class="coil" cx="-26" cy="122" r="' + r + '"/>').join("") + [30, 20, 10].map((r) => '<circle class="coil" cx="706" cy="122" r="' + r + '"/>').join("")
        + '<path class="coil" d="M-26 92 L0 116 M680 116 L706 92"/>'`, `''`) + `document.querySelector(".seg").style.width = "800px"; document.querySelector(".run").style.width = "800px";` + LEGS]],
  },
  {
    key: "T4", name: "（新）検査画像の帯を走査して欠陥を見つける: 灰の地合いの細長い画像を 3 区間に分け、済んだ区間の欠陥に赤い枠、いまの区間を走査線が走る",
    css: BASE + `
.seg .img{opacity:.35}.seg g.ok .img,.seg g.now .img{opacity:.8}.seg .box{opacity:0;fill:none!important;stroke:#ff5a45;stroke-width:2}.seg g.ok .box{opacity:1}
.seg .frame{fill:none!important;stroke:rgba(255,255,255,.25);stroke-width:1}.seg g.ok .frame{stroke:#7fd3c9;stroke-width:2}.seg g.now .frame{stroke:#bff3ec;stroke-width:2}.seg g.bad .frame{stroke:#ff8a7a}
.seg .beam{opacity:0}.seg g.now .beam{opacity:1;animation:sweep 1.5s linear infinite}@keyframes sweep{from{transform:translateX(0)}to{transform:translateX(220px)}}`,
    ops: [["script", redraw("0 0 720 110",
      `[0, 1, 2].map((i) => { const x = i * 240 + 4; return '<g><rect class="img" x="' + x + '" y="6" width="232" height="96" style="fill:url(#nz)"/>'
        + '<rect x="' + (x + 60 + i * 40) + '" y="' + (30 + i * 12) + '" width="20" height="20" style="fill:#151515"/><rect x="' + (x + 150 - i * 20) + '" y="' + (62 - i * 8) + '" width="12" height="12" style="fill:#151515"/>'
        + '<rect class="box" x="' + (x + 54 + i * 40) + '" y="' + (24 + i * 12) + '" width="32" height="32"/><rect class="box" x="' + (x + 144 - i * 20) + '" y="' + (56 - i * 8) + '" width="24" height="24"/>'
        + '<rect class="frame" x="' + x + '" y="6" width="232" height="96"/><rect class="beam" x="' + (x + 4) + '" y="4" width="3" height="100" style="fill:#e8fffb"/></g>'; }).join("")
        + '<defs><pattern id="nz" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" style="fill:#8f9aa3"/><rect width="3" height="3" style="fill:#b9c0c6"/><rect x="3" y="3" width="3" height="3" style="fill:#76818a"/></pattern></defs>'`,
      ROLLS) + LEGS]],
  },
  {
    key: "T5", name: "（新）カメラの視野の枠: 名乗りをカメラのファインダーの四隅の枠で囲み、下に 3 区間の帯（済んだ区間は ✓ と検査済みの色・いまの区間は走査線）。地に画素の細かい格子",
    css: BASE + `
.hero:before{content:"";position:absolute;left:50%;top:-22px;width:520px;height:272px;transform:translateX(-50%);pointer-events:none;
 background:linear-gradient(#7fd3c9,#7fd3c9) 0 0/28px 2px,linear-gradient(#7fd3c9,#7fd3c9) 0 0/2px 28px,linear-gradient(#7fd3c9,#7fd3c9) 100% 0/28px 2px,linear-gradient(#7fd3c9,#7fd3c9) 100% 0/2px 28px,
 linear-gradient(#7fd3c9,#7fd3c9) 0 100%/28px 2px,linear-gradient(#7fd3c9,#7fd3c9) 0 100%/2px 28px,linear-gradient(#7fd3c9,#7fd3c9) 100% 100%/28px 2px,linear-gradient(#7fd3c9,#7fd3c9) 100% 100%/2px 28px;background-repeat:no-repeat;opacity:.55}
body.is-fail .hero:before{display:none}
.seg .sec{fill:rgba(255,255,255,.06);stroke:rgba(255,255,255,.25);stroke-width:1}.seg g.ok .sec{fill:rgba(127,211,201,.22);stroke:#7fd3c9}.seg g.now .sec{stroke:#bff3ec}.seg g.bad .sec{stroke:#ff8a7a}
.seg .tick{opacity:0}.seg g.ok .tick{opacity:1}.seg .beam{opacity:0}.seg g.now .beam{opacity:1;animation:sweep 1.5s linear infinite}@keyframes sweep{from{transform:translateX(0)}to{transform:translateX(220px)}}
.motif line{stroke:rgba(127,211,201,.05)}`,
    ops: [["script", redraw("0 0 720 40",
      `[0, 1, 2].map((i) => { const x = i * 240 + 4; return '<g><rect class="sec" x="' + x + '" y="6" width="232" height="28" rx="3"/><text class="tick" x="' + (x + 210) + '" y="26" style="font:700 15px sans-serif;fill:#7fd3c9">✓</text><rect class="beam" x="' + (x + 4) + '" y="4" width="3" height="32" style="fill:#e8fffb"/></g>'; }).join("")`,
      `(() => { let h = ""; for (let x = 0; x <= 1600; x += 20) h += '<line x1="' + x + '" y1="0" x2="' + x + '" y2="400"/>'; for (let y = 0; y <= 400; y += 20) h += '<line x1="0" y1="' + y + '" x2="1600" y2="' + y + '"/>'; return h; })()`) + LEGS]],
  },
];
