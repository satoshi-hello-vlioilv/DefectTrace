// 起動画面（desktop/splash/index.html）の案（1 回目）。
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-10-27-splash.mjs
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
.legs{display:grid;grid-template-columns:repeat(3,1fr);margin-top:10px;font-size:13px;color:rgba(255,255,255,.5)}
.legs span{text-align:center}.legs span.now{color:#fff;font-weight:700}.legs span.ok{color:#7fd3c9}.legs span.ok:before{content:"✓ "}
.legs span.bad{color:#ff8a7a;font-weight:700}.legs span.warn{color:#e6a52e}
.motif{height:46vh;left:0;width:100%}
.seg>g{stroke:none!important;filter:none!important;animation:none!important}.seg path{stroke-width:1.5}
#stepTitle{display:none}.step{justify-content:flex-end}`;
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
const MARKS = `const mk = (k, x, y, s) => k === 0 ? '<circle cx="' + x + '" cy="' + y + '" r="' + s + '" fill="#e0412c"/>'
  : k === 1 ? '<path d="M' + x + ' ' + (y - s) + 'L' + (x + s) + ' ' + (y + s) + 'L' + (x - s) + ' ' + (y + s) + 'Z" fill="#4c8dff"/>'
  : k === 2 ? '<rect x="' + (x - s) + '" y="' + (y - s) + '" width="' + 2 * s + '" height="' + 2 * s + '" fill="#2fbf71"/>'
  : '<path d="M' + x + ' ' + (y - s) + 'L' + (x + s * .35) + ' ' + (y - s * .3) + 'L' + (x + s) + ' ' + (y - s * .2) + 'L' + (x + s * .5) + ' ' + (y + s * .3) + 'L' + (x + s * .6) + ' ' + (y + s) + 'L' + x + ' ' + (y + s * .6) + 'L' + (x - s * .6) + ' ' + (y + s) + 'L' + (x - s * .5) + ' ' + (y + s * .3) + 'L' + (x - s) + ' ' + (y - s * .2) + 'L' + (x - s * .35) + ' ' + (y - s * .3) + 'Z" fill="#e6a52e"/>';
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;`;

export const PROPOSALS = [
  {
    key: "S1", name: "流れる板と走査線: 進み具合は板の 3 区間（済んだ区間は検査済みの色・欠陥の印）。いまの区間を光の線が走る。下に板とローラーの断面",
    css: BASE + `
.seg .sec{fill:rgba(255,255,255,.05);stroke:rgba(255,255,255,.18);stroke-width:1}
.seg g .dots{opacity:0;transition:opacity .4s}.seg g.ok .sec{fill:rgba(127,211,201,.16);stroke:#7fd3c9}.seg g.ok .dots{opacity:1}
.seg g.warn .sec{fill:rgba(230,165,46,.16);stroke:#e6a52e}.seg g.bad .sec{fill:rgba(255,138,122,.14);stroke:#ff8a7a}
.seg .beam{opacity:0}.seg g.now .beam{opacity:1;animation:sweep 1.6s linear infinite}.seg g.now .sec{stroke:#7fd3c9}
@keyframes sweep{from{transform:translateX(0)}to{transform:translateX(226px)}}
.motif .strip{fill:rgba(127,211,201,.05);stroke:rgba(127,211,201,.12)}.motif .roll{fill:none;stroke:rgba(127,211,201,.12);stroke-width:3}
.motif .cam{fill:rgba(127,211,201,.1)}.motif .light{fill:rgba(127,211,201,.05)}`,
    ops: [["script", MARKS + redraw("0 0 720 70",
      `[0, 1, 2].map((i) => { const x = i * 240; let d = ""; for (let k = 0; k < 7; k++) d += mk(k % 4, x + 18 + rnd() * 200, 14 + rnd() * 40, 3.2);
        return '<g><rect class="sec" x="' + (x + 2) + '" y="6" width="236" height="56" rx="3"/><g class="dots">' + d + '</g><rect class="beam" x="' + (x + 4) + '" y="2" width="3" height="64" fill="#bff3ec" style="filter:drop-shadow(0 0 6px #7fd3c9)"/></g>'; }).join("")`,
      `'<path class="light" d="M1380 120 L1300 300 L1460 300Z"/><rect class="cam" x="1350" y="88" width="60" height="34" rx="4"/>'
        + '<rect class="strip" x="0" y="300" width="1600" height="26"/><circle class="roll" cx="120" cy="360" r="34"/><circle class="roll" cx="1480" cy="360" r="34"/>'
        + '<circle class="roll" cx="560" cy="360" r="34"/><circle class="roll" cx="1040" cy="360" r="34"/>'`) + LEGS]],
  },
  {
    key: "S2", name: "欠陥の MAP が埋まる: 進み具合は表面・裏面の 2 本の帯を長さ方向に 3 つに分け、済んだ所に欠陥の印が出る（画面の MAP と同じ印）",
    css: BASE + `
.seg .lane{fill:rgba(255,255,255,.04);stroke:rgba(255,255,255,.2)}.seg g .dots{opacity:0}.seg g.ok .dots{opacity:1}.seg g.ok .lane{fill:rgba(255,255,255,.08);stroke:rgba(127,211,201,.7)}
.seg g.now .lane{stroke:#7fd3c9}.seg .scan{opacity:0}.seg g.now .scan{opacity:1;animation:sweep 1.4s linear infinite}
.seg g.bad .lane{stroke:#ff8a7a}.seg g.warn .lane{stroke:#e6a52e}
@keyframes sweep{from{transform:translateX(0)}to{transform:translateX(230px)}}
.seg text{fill:rgba(255,255,255,.55);font:11px "Yu Gothic UI",sans-serif}
.motif line{stroke:rgba(127,211,201,.06)}.motif text{fill:rgba(127,211,201,.12);font:12px Consolas,monospace}`,
    ops: [["script", MARKS + redraw("0 0 720 120",
      `[0, 1, 2].map((i) => { const x = 40 + i * 226; let d = ""; for (let k = 0; k < 9; k++) d += mk(k % 4, x + 10 + rnd() * 206, (k % 2 ? 72 : 22) + rnd() * 30, 3.4);
        return '<g><rect class="lane" x="' + x + '" y="12" width="224" height="46"/><rect class="lane" x="' + x + '" y="64" width="224" height="46"/><g class="dots">' + d + '</g><rect class="scan" x="' + x + '" y="8" width="2" height="106" fill="#bff3ec"/></g>'; }).join("")
        + '<text x="0" y="40">表面</text><text x="0" y="92">裏面</text>'`,
      `(() => { let h = ""; for (let x = 0; x <= 1600; x += 80) h += '<line x1="' + x + '" y1="0" x2="' + x + '" y2="400"/>'; for (let y = 0; y <= 400; y += 80) h += '<line x1="0" y1="' + y + '" x2="1600" y2="' + y + '"/>';
        for (let x = 0; x < 1600; x += 320) h += '<text x="' + (x + 4) + '" y="392">' + (x * 2) + ' m</text>'; return h; })()`) + LEGS]],
  },
  {
    key: "S3", name: "物差しの目盛り（検査幅 mm）: 進み具合は目盛りの 3 区間を検査ヘッド（▼）が進む。下に細かな目盛りの模様",
    css: BASE + `
.seg .rule{stroke:rgba(255,255,255,.25);stroke-width:1.5}.seg .tick{stroke:rgba(255,255,255,.3)}
.seg g.ok .rule,.seg g.ok .tick{stroke:#7fd3c9}.seg g.ok .rule{stroke-width:4}.seg g.warn .rule{stroke:#e6a52e;stroke-width:4}.seg g.bad .rule{stroke:#ff8a7a;stroke-width:4}
.seg .head{opacity:0}.seg g.now .head{opacity:1;animation:go 1.6s ease-in-out infinite alternate}.seg g.now .rule{stroke:#bff3ec}
@keyframes go{from{transform:translateX(0)}to{transform:translateX(220px)}}
.seg text{fill:rgba(255,255,255,.5);font:11px Consolas,monospace}
.motif line{stroke:rgba(127,211,201,.08)}`,
    ops: [["script", redraw("0 0 720 80",
      `[0, 1, 2].map((i) => { const x = 10 + i * 233; let t = ""; for (let k = 0; k <= 10; k++) t += '<line class="tick" x1="' + (x + k * 22) + '" y1="46" x2="' + (x + k * 22) + '" y2="' + (k % 5 ? 54 : 60) + '"/>';
        return '<g><line class="rule" x1="' + x + '" y1="46" x2="' + (x + 222) + '" y2="46"/>' + t + '<path class="head" d="M' + x + ' 40 l-8 -14 h16z" fill="#bff3ec"/><text x="' + x + '" y="76">' + (i * 550) + '</text></g>'; }).join("") + '<text x="672" y="76">1650 mm</text>'`,
      `(() => { let h = ""; for (let x = 0; x <= 1600; x += 16) h += '<line x1="' + x + '" y1="400" x2="' + x + '" y2="' + (x % 160 ? 370 : x % 800 ? 330 : 280) + '"/>'; return h; })()`) + LEGS]],
  },
  {
    key: "S4", name: "検査画像のコマ: 進み具合は 3 枚のコマ（画面の画像の枠と同じ形）。済んだコマは欠陥が見つかった絵になり、いまのコマを走査線が下る",
    css: BASE + `
.seg .fr{fill:rgba(255,255,255,.04);stroke:rgba(255,255,255,.25);stroke-width:1.5}.seg .tex{opacity:.15}.seg .dfx{opacity:0}
.seg g.ok .fr{stroke:#4c8dff}.seg g.ok .tex{opacity:.55}.seg g.ok .dfx{opacity:1}.seg g.warn .fr{stroke:#e6a52e}.seg g.bad .fr{stroke:#ff8a7a}
.seg g.now .fr{stroke:#7fd3c9}.seg g.now .tex{opacity:.35}.seg .scan{opacity:0}.seg g.now .scan{opacity:1;animation:down 1.3s linear infinite}
@keyframes down{from{transform:translateY(0)}to{transform:translateY(118px)}}
.seg text{fill:rgba(255,255,255,.7);font:12px "Yu Gothic UI",sans-serif}
.motif rect{fill:none;stroke:rgba(127,211,201,.06);stroke-width:2}`,
    ops: [["script", MARKS + redraw("0 0 720 150",
      `'<defs><pattern id="nz" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#9aa4ad"/><rect width="4" height="4" fill="#c7ccd1"/><rect x="4" y="4" width="4" height="4" fill="#7d8790"/></pattern></defs>'
        + [0, 1, 2].map((i) => { const x = 20 + i * 236, n = ["中身", "版", "画面"][i];
        return '<g><rect class="fr" x="' + x + '" y="14" width="208" height="128" rx="4"/><rect x="' + (x + 12) + '" y="6" width="' + (n.length * 13 + 18) + '" height="16" fill="#1c3550"/><text x="' + (x + 20) + '" y="19">' + (i + 1) + ' ' + n + '</text>'
          + '<rect class="tex" x="' + (x + 12) + '" y="26" width="184" height="104" fill="url(#nz)"/><rect class="dfx" x="' + (x + 70 + i * 30) + '" y="' + (56 + i * 10) + '" width="22" height="22" fill="#111"/>'
          + '<rect class="dfx" x="' + (x + 66 + i * 30) + '" y="' + (52 + i * 10) + '" width="30" height="30" fill="none" stroke="#e0412c" stroke-width="2"/><rect class="scan" x="' + (x + 12) + '" y="20" width="184" height="2" fill="#bff3ec"/></g>'; }).join("")`,
      `(() => { let h = ""; for (let i = 0; i < 8; i++) h += '<rect x="' + (i * 190 + 20) + '" y="' + (120 + (i % 2) * 60) + '" width="160" height="110" rx="6"/>'; return h; })()`) + LEGS]],
  },
  {
    key: "S5", name: "カメラと光: 流れる板の上に 3 台のラインカメラ。段が済むごとにカメラの光が灯り、いまのカメラの光がゆっくり明滅する",
    css: BASE + `
.seg .cone{fill:rgba(127,211,201,.06)}.seg .cam{fill:#3b5068;stroke:rgba(255,255,255,.35)}.seg .lamp{fill:rgba(255,255,255,.25)}
.seg g.ok .cone{fill:rgba(127,211,201,.28)}.seg g.ok .lamp{fill:#7fd3c9}.seg g.now .cone{fill:rgba(127,211,201,.3);animation:breathe2 1.4s ease-in-out infinite}.seg g.now .lamp{fill:#bff3ec}
.seg g.warn .lamp{fill:#e6a52e}.seg g.bad .lamp{fill:#ff8a7a}.seg g.bad .cone{fill:rgba(255,138,122,.18)}
@keyframes breathe2{0%,100%{opacity:.35}50%{opacity:1}}
.seg .strip{fill:rgba(255,255,255,.12)}.seg .roll{fill:none;stroke:rgba(255,255,255,.3);stroke-width:2}
.motif .strip{fill:rgba(127,211,201,.04)}.motif .roll{fill:none;stroke:rgba(127,211,201,.08);stroke-width:3}`,
    ops: [["script", redraw("0 0 720 150",
      `[0, 1, 2].map((i) => { const x = 120 + i * 240;
        return '<g><path class="cone" d="M' + (x - 8) + ' 40 L' + (x - 100) + ' 118 L' + (x + 100) + ' 118 L' + (x + 8) + ' 40Z"/><rect class="cam" x="' + (x - 26) + '" y="10" width="52" height="30" rx="4"/><circle class="lamp" cx="' + x + '" cy="25" r="6"/></g>'; }).join("")
        + '<rect class="strip" x="0" y="118" width="720" height="8"/><circle class="roll" cx="40" cy="138" r="12"/><circle class="roll" cx="360" cy="138" r="12"/><circle class="roll" cx="680" cy="138" r="12"/>'`,
      `'<rect class="strip" x="0" y="330" width="1600" height="14"/>' + [100, 420, 740, 1060, 1380].map((x) => '<circle class="roll" cx="' + x + '" cy="372" r="26"/>').join("")`) + LEGS]],
  },
  {
    key: "S6", name: "名乗りを左・絵を右の 2 列: 右に流れる板と走査線（S1 の絵を大きく）、左に名前・版・段の一覧（✓・いま・まだ）。空きを減らす",
    css: BASE + `
.hero{display:grid;grid-template-columns:300px 640px;column-gap:56px;align-items:center;text-align:left;width:auto}
.hero>.logo{grid-column:1;grid-row:1}.hero>h1{grid-column:1;grid-row:2;margin-top:14px;font-size:40px}.hero>.sub{grid-column:1;grid-row:3}.hero>.ver{grid-column:1;grid-row:4}
.hero>.run{grid-column:2;grid-row:1/6;width:640px;margin:0}.seg{width:640px}
.hero>.panel{grid-column:1/3;grid-row:6}
.legs{display:flex;flex-direction:column;gap:6px;font-size:14px}.legs span{text-align:left}
.seg .sec{fill:rgba(255,255,255,.05);stroke:rgba(255,255,255,.18)}.seg g .dots{opacity:0}.seg g.ok .sec{fill:rgba(127,211,201,.16);stroke:#7fd3c9}.seg g.ok .dots{opacity:1}
.seg g.bad .sec{stroke:#ff8a7a}.seg .beam{opacity:0}.seg g.now .beam{opacity:1;animation:sweep 1.6s linear infinite}
@keyframes sweep{from{transform:translateX(0)}to{transform:translateX(200px)}}
body.is-fail .hero{display:flex;flex-direction:column;align-items:center;text-align:center}`,
    ops: [["script", MARKS + redraw("0 0 640 120",
      `[0, 1, 2].map((i) => { const x = i * 213; let d = ""; for (let k = 0; k < 7; k++) d += mk(k % 4, x + 16 + rnd() * 180, 20 + rnd() * 80, 3.6);
        return '<g><rect class="sec" x="' + (x + 2) + '" y="8" width="209" height="104" rx="3"/><g class="dots">' + d + '</g><rect class="beam" x="' + (x + 4) + '" y="2" width="3" height="116" fill="#bff3ec"/></g>'; }).join("")`,
      `''`) + LEGS]],
  },
];
