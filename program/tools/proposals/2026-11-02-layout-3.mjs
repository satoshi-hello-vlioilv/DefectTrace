// 機能ブロックの配置の案（3 回目）。2 回目（2026-11-02-layout-2.mjs）は 1 位 H 77.4 点・G 76.8 点で 80 点に届かなかった:
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-11-02-layout-3.mjs
//
// 2 回目の採点で低かった所（2026-11-02-layout.json の rounds[1]）:
//  - 全案: 4 欄の 1280 でフィルタの行の説明が字の途中で切れる（−5）→ 説明は省略記号で切る・4 欄のときは各欄を細く（左 230・2 列目 250・右 290）
//  - 全案: 1280 で MAP の図が切れ、凡例はブロックの中を送らないと見えない（−3）→ MAP の図はブロックの高さに合わせて縮む（凡例・横縦の受けは図の下に必ず出る）・MAP は最小 400px（画像情報・ロット情報が中を送る）
//  - H: ふだんは移せることが見えない → つかむ所 ⠿ と ⋯ はふだんから出す
//  - G: ⋯ の「← 左の欄へ（いまの場所）」は押しても何も起きない → 移せる先だけを出す。欄の数の入口は上の「画面の配置」1 か所に
// 案の方向（新しい案 3 つ: M・N・O）: L＝H と G を合わせた物・G3＝G を直した物・M＝欄の数の絵を上の帯に常に並べる（1 手で切り替え）・
//   N＝ブロックを別のブロックの見出しへ落とすとタブで重なる（欄の中に重ねて高さを稼ぐ）・O＝ブロックを窓の上に浮かせる（⋯ の「浮かせる」）
//
// 1 回目の採点で低かった所（2026-11-02-layout.json の rounds[0]）:
//  - B: 仕分けの見出しの説明が「…行を押す…」で切れる（−5）→ 見出しは名前と数だけ・説明は見出しの下の 1 行（折り返してよい）
//  - 配置の入口が上の帯の右端だけ → ブロックの見出しにも「⋯」（移す先・たたむ・高さを戻す）
//  - 境目のつまみが細く薄い → 8px・濃い・触れると色
//  - 「左 2 列」の後の画面を撮っていない（1280 で中央が狭くならないか）→ 状態 cols で撮る。4 欄のときは各欄を細くする
//  - 仕分けの下が大きく空く → 中身の高さで止め、空いた所はロットへ回す
// 効いた所（持ち越す）: B の ⠿ でつかむ・境目・欄の数の絵付きの 4 択・よく使う形・「ここへ移す」の線
// 案の方向: G＝B を直した物（置き場を全部の見出しから）・H＝配置を変える間だけ枠と道具が出る（編集の様子）・
//   I＝つかまずに見出しのボタンで移す（左右の矢印）・J＝木を短くする（減らし方）＋境目・K＝欄の端の「＋」で欄を足す（欄の数を画面の上で）

export const SETUP = `return fetch("/api/classes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({groups:[{id:"a",name:"黒点",examples:[]},{id:"b",name:"スジ",examples:[]}]})})`;
const LONG = `const eq = document.querySelector("#tree>li"); const ul = eq.querySelector(":scope>ul") || eq.appendChild(document.createElement("ul"));
  for (let i = 0; i < 26; i++) ul.insertAdjacentHTML("afterbegin", '<li><div class="row"><span class="tw">▶</span><span class="nm">2026/' + String(10 - (i % 3)).padStart(2,"0") + "/" + String(28 - i).padStart(2, "0") + ' (月)</span><span class="cnt">' + (3 + i % 5) + 'ロット</span></div></li>');`;
const REDRAW = `window.dispatchEvent(new Event("resize"));`;
const WAIT = `new Promise((r) => setTimeout(r, 400))`;
export const STATES = {
  lot: `${LONG} if (window.__lay) window.__lay(); window.dispatchEvent(new Event("resize")); return ${WAIT}`,
  alt: `if (window.__alt) window.__alt(); return ${WAIT}`,
  cols: `document.querySelectorAll(".lay-menu,.blk-menu,.drop-line,.lay-ghost").forEach((e) => e.remove()); document.body.classList.remove("lay-edit"); if (window.__cols) window.__cols(); window.dispatchEvent(new Event("resize")); return ${WAIT}`,
};

// ブロックの殻: 見出し（⠿・▾・名前・数・⋯）＋説明の行（任意）＋中身。右の欄の details も同じ殻へ
const LIB = `window.__blk = (key, title, nodes, o = {}) => { const s = document.createElement("section"); s.className = "blk"; s.dataset.blk = key;
  s.innerHTML = '<div class="bh">' + (o.grip === false ? "" : '<span class="grip" title="つかんで移す">⠿</span>') + '<span class="tw2">▾</span><b>' + title + '</b><span class="bn">' + (o.n || "") + '</span><span class="bsp"></span>' + (o.tools || "") + '</div>' + (o.desc ? '<div class="bdesc">' + o.desc + '</div>' : "") + '<div class="bb"></div>';
  nodes.forEach((n) => s.querySelector(".bb").append(n)); return s; };
  window.__wrap = (o = {}) => { const p = document.getElementById("treePane"), tools = o.tools || "";
    const t = __blk("tree", "ロット", [p.querySelector(".pane-head"), document.getElementById("tree"), p.querySelector(".nb-leg")], { n: "LS3・DL2", grip: o.grip, tools });
    const c = __blk("cls", "仕分け", [document.getElementById("clsPane")], { n: "2 グループ", grip: o.grip, tools, desc: "カードをグループへドラッグ・行を押すと一覧を絞る" });
    p.append(t); p.insertAdjacentHTML("beforeend", '<div class="hsplit" title="ドラッグで高さを変える"></div>'); p.append(c);
    const ip = document.getElementById("infoPane"); const names = ["画像情報", "MAP", "ロット情報"], keys = ["img", "map", "lot"];
    [...ip.querySelectorAll(":scope>details.box")].forEach((d, i) => { const sub = d.querySelector("summary .sub"); const kids = [...d.children].filter((x) => x.tagName !== "SUMMARY");
      const b = __blk(keys[i], names[i], kids, { n: sub ? sub.outerHTML : "", grip: o.grip, tools }); d.replaceWith(b); });
    [...ip.querySelectorAll(":scope>.blk")].slice(0, -1).forEach((b) => b.insertAdjacentHTML("afterend", '<div class="hsplit"></div>')); return [t, c]; };
  window.__four = () => { const sp = document.querySelector(".split[data-split=treePane]"); sp.insertAdjacentHTML("afterend", '<aside id="col2"></aside><div class="split"></div>');
    const c2 = document.getElementById("col2"); const c = document.querySelector('.blk[data-blk=cls]'); c.previousElementSibling.remove(); c2.append(c);
    document.getElementById("treePane").style.width = "240px"; c2.style.width = "240px"; document.getElementById("infoPane").style.width = "290px"; };`;
const BASE = `#treePane{padding:0;gap:0}#infoPane{padding:0;gap:0}#col2{background:var(--pane);display:flex;flex-direction:column;flex:0 0 auto}
.blk{display:flex;flex-direction:column;min-height:0;background:var(--pane)}
.blk>.bh{flex:none;display:flex;align-items:center;gap:6px;padding:5px 6px;border-bottom:1px solid var(--line2);background:#f3f6fa;font-size:13px;color:var(--acc)}
.blk>.bh b{font-weight:700;white-space:nowrap}.bn{color:var(--sub);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}.bn .sub{color:var(--sub)}.bsp{flex:1}
.bdesc{flex:none;font-size:12px;color:var(--sub);padding:4px 10px 0;line-height:1.45}
.grip{cursor:grab;color:#6b7a8f;font-size:14px;letter-spacing:-1px;padding:0 2px}
.tw2{font-size:11px;color:var(--acc);width:12px;text-align:center}
.bmore{border:1px solid transparent;background:none;color:#4a5a70;border-radius:4px;padding:0 6px;font-size:14px;line-height:20px}
.bmore:hover{border-color:var(--line)}
.blk>.bb{flex:1;min-height:0;display:flex;flex-direction:column;overflow:auto}
.blk[data-blk=tree]>.bb>#tree{flex:1 1 auto;min-height:0}
.blk{flex:var(--w,1) 1 0;min-height:64px}
.blk[data-blk=tree]{--w:1}.blk[data-blk=cls]{--w:1.15}
#infoPane>.blk>.bb{padding:4px 8px}#infoPane>.blk[data-blk=img]{--w:.8}#infoPane>.blk[data-blk=map]{--w:1.6;min-height:400px}#infoPane>.blk[data-blk=lot]{--w:.5}
#infoPane>.blk[data-blk=map]>.bb{overflow:hidden}#infoPane>.blk[data-blk=map]>.bb>*{flex:none}#infoPane>.blk[data-blk=map]>.bb>canvas{flex:1 1 0;min-height:110px;height:auto!important;width:calc(100% - 16px)}
.f-bar .f-none{overflow:hidden;text-overflow:ellipsis;min-width:0}.f-chips{min-width:0}
.blk .cls-pane{border-top:none;overflow:visible;flex:none}.blk .cls-head{display:none}
.blk .nb-leg{margin-top:0;flex:none}
.hsplit{flex:0 0 8px;cursor:row-resize;background:#dfe6ef;position:relative;border-top:1px solid #c5d0de;border-bottom:1px solid #c5d0de}
.hsplit::after{content:"";position:absolute;left:50%;top:2px;width:36px;margin-left:-18px;height:2px;border-top:1px solid #7f91a8;border-bottom:1px solid #7f91a8}
.hsplit:hover{background:var(--acc)}
.lay-btn{margin-left:auto;align-self:center;border:1px solid #b7cbe6;background:var(--pane);color:var(--acc);border-radius:5px;padding:3px 10px;font-size:13px;white-space:nowrap}
#modeBar{display:flex;align-items:flex-end;padding-right:12px;position:relative}
.lay-menu,.blk-menu{position:absolute;z-index:60;background:var(--pane);border:1px solid var(--line);border-radius:8px;box-shadow:0 12px 30px rgba(0,0,0,.18);padding:12px 14px;display:flex;flex-direction:column;gap:10px;font-size:13px}
.lay-menu{right:12px;top:calc(100% + 4px);width:480px}
.lay-menu h5,.blk-menu h5{margin:0;font-size:12px;color:var(--sub);font-weight:600}
.lay-opts{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.lay-opt{border:1px solid var(--line);border-radius:6px;padding:6px;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:12px;background:var(--pane)}
.lay-opt.on{border:2px solid var(--acc);background:var(--accbg)}
.lay-ic{display:flex;gap:2px;width:64px;height:38px}.lay-ic i{background:#c9d6e8;border-radius:2px}.lay-ic i.c{background:#eef2f7;border:1px solid #c9d6e8;flex:1}
.lay-hint{color:var(--sub);font-size:12px;line-height:1.5}
.blk-menu{width:230px;gap:4px;padding:8px}.blk-menu button{text-align:left;border:none;background:none;padding:5px 8px;border-radius:4px;font-size:13px}.blk-menu button:hover,.blk-menu button.hi{background:var(--accbg)}
.blk-menu hr{border:none;border-top:1px solid var(--line2);margin:2px 0}`;
const ic = `const ic = (l) => '<span class="lay-ic">' + l.map((w) => w ? '<i style="flex:0 0 ' + w + 'px"></i>' : '<i class="c"></i>').join("") + '</span>';`;
const MENU = `${ic} document.getElementById("modeBar").insertAdjacentHTML("beforeend", '<div class="lay-menu"><h5>欄の数</h5><div class="lay-opts">'
  + '<button class="lay-opt on">' + ic([14, 0, 14]) + '左・中・右</button><button class="lay-opt">' + ic([10, 10, 0, 14]) + '左2列・中・右</button><button class="lay-opt">' + ic([14, 0]) + '左・中</button><button class="lay-opt">' + ic([0, 14]) + '中・右</button></div>'
  + '<h5>よく使う形</h5><div class="lay-opts"><button class="lay-opt">標準</button><button class="lay-opt">仕分けを広く</button><button class="lay-opt">画像を大きく</button><button class="lay-opt">元に戻す</button></div>'
  + '<div class="lay-hint">ブロックは見出しの ⠿ をつかんで欄の間を移す・境目をドラッグで高さ・見出しを押すとたたむ。配置はこの PC に残ります</div></div>');`;
const BMENU3 = (blk) => `const h = document.querySelector('.blk[data-blk=${blk}]>.bh'); const r = h.getBoundingClientRect();
  document.body.insertAdjacentHTML("beforeend", '<div class="blk-menu" style="left:' + (r.right - 236) + 'px;top:' + (r.bottom + 2) + 'px"><h5>仕分けを移す先</h5><button class="hi">右の欄へ →</button><button>新しい 2 列目へ（左に欄を足す）</button><hr><button>たたむ</button><button>高さを戻す</button></div>');`;
const BMENU = (blk) => `const h = document.querySelector('.blk[data-blk=${blk}]>.bh'); const r = h.getBoundingClientRect();
  document.body.insertAdjacentHTML("beforeend", '<div class="blk-menu" style="left:' + (r.right - 236) + 'px;top:' + (r.bottom + 2) + 'px"><h5>仕分けを移す</h5><button>← 左の欄へ（いまの場所）</button><button class="hi">左に 2 列目を足して移す</button><button>右の欄へ →</button><hr><button>たたむ</button><button>高さを戻す</button></div>');`;
const MORE = '<button class="bmore" title="移す先・たたむ・高さを戻す">⋯</button>';

export const PROPOSALS = [
  {
    key: "L", name: "H と G を合わせた物（⠿・⋯ はふだんから・「画面の配置」で編集の帯と欄の数）",
    css: BASE + `body.lay-edit .blk{outline:2px dashed #7aa0d4;outline-offset:-3px}body.lay-edit .blk>.bh{background:#e8f0fb}
.lay-bar{position:absolute;right:12px;top:50%;transform:translateY(-50%);z-index:60;display:none;align-items:center;gap:8px;background:#1f3a5f;color:#fff;border-radius:7px;padding:3px 8px;font-size:12.5px;box-shadow:0 6px 16px rgba(0,0,0,.22)}
body.lay-edit .lay-bar{display:flex}body.lay-edit .lay-btn{visibility:hidden}
.lay-bar .lay-ic{width:26px;height:15px}.lay-bar .lo{display:flex;flex-direction:row;align-items:center;gap:4px;white-space:nowrap;border:1px solid #47658f;background:#2a4a75;color:#fff;border-radius:5px;padding:3px 6px;font-size:11.5px}.lay-bar .lo.on{border:2px solid #9cc3ff;background:#35598c}
.lay-bar .done{background:#fff;color:#1f3a5f;border:none;border-radius:5px;padding:2px 12px;font-weight:700;white-space:nowrap}.lay-bar .rs{background:none;border:1px solid #6d86aa;color:#dfe9f7;border-radius:5px;padding:3px 8px;font-size:12px}`,
    ops: [["script", LIB], ["insert", '<button type="button" class="lay-btn">▥ 画面の配置</button>', "beforeend", "#modeBar"],
      ["script", `${ic} document.getElementById("modeBar").insertAdjacentHTML("beforeend", '<div class="lay-bar"><span>欄の数</span><button class="lo on">' + ic([10, 0, 10]) + '左・中・右</button><button class="lo">' + ic([7, 7, 0, 10]) + '左2列</button><button class="lo">' + ic([10, 0]) + '左・中</button><button class="lo">' + ic([0, 10]) + '中・右</button><span style="opacity:.85;white-space:nowrap">⠿ で移す</span><button class="rs">元に戻す</button><button class="done">終わる</button></div>');
        window.__lay = () => __wrap({ tools: '${MORE}' }); window.__alt = () => { document.body.classList.add("lay-edit"); ${BMENU3("cls")} }; window.__cols = () => __four();`]],
  },
  {
    key: "G3", name: "G を直した物（⋯ は移せる先だけ・欄の数は上の「画面の配置」だけ）",
    css: BASE,
    ops: [["script", LIB], ["insert", '<button type="button" class="lay-btn">▥ 画面の配置 ▾</button>', "beforeend", "#modeBar"],
      ["script", `window.__lay = () => __wrap({ tools: '${MORE}' }); window.__alt = () => { ${MENU} ${BMENU3("cls")} }; window.__cols = () => __four();`]],
  },
  {
    key: "M", name: "欄の数の絵を上の帯に常に並べる（1 手で切り替え）＋⠿・⋯",
    css: BASE + `.lay-strip{margin-left:auto;align-self:center;display:flex;align-items:center;gap:4px;font-size:12.5px;color:var(--sub)}
.lay-strip .lo{border:1px solid var(--line);background:var(--pane);border-radius:5px;padding:3px 5px;display:flex}.lay-strip .lo.on{border:2px solid var(--acc);background:var(--accbg)}
.lay-strip .lay-ic{width:34px;height:18px}.lay-strip .rs{border:1px solid var(--line);background:var(--pane);border-radius:5px;font-size:12px;padding:2px 8px;color:var(--sub)}`,
    ops: [["script", LIB], ["script", `${ic} document.getElementById("modeBar").insertAdjacentHTML("beforeend", '<div class="lay-strip">画面の配置 <button class="lo on" title="左・中・右">' + ic([8, 0, 8]) + '</button><button class="lo" title="左2列・中・右">' + ic([5, 5, 0, 8]) + '</button><button class="lo" title="左・中">' + ic([8, 0]) + '</button><button class="lo" title="中・右">' + ic([0, 8]) + '</button><button class="rs">元に戻す</button></div>');
        window.__lay = () => __wrap({ tools: '${MORE}' }); window.__alt = () => { ${BMENU3("cls")} }; window.__cols = () => { __four(); const b = document.querySelectorAll(".lay-strip .lo"); b[0].classList.remove("on"); b[1].classList.add("on"); };`]],
  },
  {
    key: "N", name: "見出しへ落とすとタブで重なる（ロット｜仕分け を重ねて高さを稼ぐ）＋⠿・⋯",
    css: BASE + `.blk>.bh.tabs{padding:0 6px 0 6px;gap:0;align-items:stretch}.bh.tabs .grip{align-self:center;margin-right:4px}
.bh.tabs .tb{display:flex;align-items:center;gap:5px;padding:6px 12px;border-bottom:3px solid transparent;color:var(--sub);font-weight:600;white-space:nowrap}.bh.tabs .tb.on{color:var(--acc);border-bottom-color:var(--acc);background:var(--pane)}
.bh.tabs .bsp{flex:1}.bh.tabs .bmore{align-self:center}
.drop-tab{outline:2px dashed var(--acc);outline-offset:-2px;background:var(--accbg)!important}.drop-tab::after{content:"ここに落とすとタブで重なる";font-size:12px;color:#fff;background:var(--acc);border-radius:4px;padding:0 6px;align-self:center;margin-left:6px}`,
    ops: [["script", LIB], ["insert", '<button type="button" class="lay-btn">▥ 画面の配置 ▾</button>', "beforeend", "#modeBar"],
      ["script", `window.__lay = () => __wrap({ tools: '${MORE}' });
        window.__alt = () => { document.querySelector('#infoPane>.blk[data-blk=map]>.bh').classList.add("drop-tab"); };
        window.__cols = () => { document.querySelector(".drop-tab")?.classList.remove("drop-tab"); const t = document.querySelector('.blk[data-blk=tree]'), c = document.querySelector('.blk[data-blk=cls]');
          c.previousElementSibling.remove(); t.after(c); t.hidden = true; c.style.flex = "1"; const h = c.querySelector(".bh"); h.className = "bh tabs";
          h.innerHTML = '<span class="grip">⠿</span><span class="tb">ロット</span><span class="tb on">仕分け <span class="bn">2</span></span><span class="bsp"></span>${MORE}'; };`]],
  },
  {
    key: "O", name: "ブロックを窓の上に浮かせる（⋯ の「浮かせる」・大きさは角で）＋⠿",
    css: BASE + `.blk.float{position:fixed;z-index:55;border:1px solid #9fb6d6;border-radius:8px;box-shadow:0 16px 40px rgba(0,0,0,.28);overflow:hidden;resize:both}
.blk.float>.bh{cursor:move;background:#e8f0fb}.blk.float::after{content:"";position:absolute;right:3px;bottom:3px;width:12px;height:12px;background:linear-gradient(135deg,transparent 45%,#8a97a8 45% 52%,transparent 52% 65%,#8a97a8 65% 72%,transparent 72%)}
.dock-back{border:1px solid var(--line);background:var(--pane);border-radius:4px;font-size:12px;padding:0 6px;color:var(--acc)}`,
    ops: [["script", LIB], ["insert", '<button type="button" class="lay-btn">▥ 画面の配置 ▾</button>', "beforeend", "#modeBar"],
      ["script", `window.__lay = () => __wrap({ tools: '${MORE}' });
        window.__alt = () => { const c = document.querySelector('.blk[data-blk=cls]'); c.previousElementSibling.remove(); c.classList.add("float"); document.body.append(c);
          const g = document.getElementById("grid").getBoundingClientRect(); Object.assign(c.style, { left: (g.right - 420) + "px", top: (g.top + 10) + "px", width: "400px", height: "460px", flex: "none" });
          c.querySelector(".bmore").insertAdjacentHTML("beforebegin", '<button class="dock-back" title="元の欄へ戻す">欄へ戻す</button>'); };
        window.__cols = () => { const c = document.querySelector(".blk.float"); if (c) { c.classList.remove("float"); c.removeAttribute("style"); c.querySelector(".dock-back")?.remove(); const p = document.getElementById("treePane"); p.insertAdjacentHTML("beforeend", '<div class="hsplit"></div>'); p.append(c); } __four(); };`]],
  },
];
