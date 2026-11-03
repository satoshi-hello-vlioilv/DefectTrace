// 機能ブロックの配置の案（2 回目）。1 回目（2026-11-02-layout.mjs）は 1 位 B 76.0 点で 80 点に届かなかった:
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-11-02-layout-2.mjs
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
const WAIT = `new Promise((r) => setTimeout(r, 400))`;
export const STATES = {
  lot: `${LONG} if (window.__lay) window.__lay(); return ${WAIT}`,
  alt: `if (window.__alt) window.__alt(); return ${WAIT}`,
  cols: `document.querySelectorAll(".lay-menu,.blk-menu,.drop-line,.lay-ghost").forEach((e) => e.remove()); if (window.__cols) window.__cols(); return ${WAIT}`,
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
    document.getElementById("treePane").style.width = "250px"; c2.style.width = "270px"; document.getElementById("infoPane").style.width = "300px"; };`;
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
#infoPane>.blk>.bb{padding:4px 8px}#infoPane>.blk[data-blk=img]{--w:1}#infoPane>.blk[data-blk=map]{--w:1.4;min-height:220px}#infoPane>.blk[data-blk=lot]{--w:.6}
#infoPane>.blk[data-blk=map] canvas{min-height:150px}
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
const BMENU = (blk) => `const h = document.querySelector('.blk[data-blk=${blk}]>.bh'); const r = h.getBoundingClientRect();
  document.body.insertAdjacentHTML("beforeend", '<div class="blk-menu" style="left:' + (r.right - 236) + 'px;top:' + (r.bottom + 2) + 'px"><h5>仕分けを移す</h5><button>← 左の欄へ（いまの場所）</button><button class="hi">左に 2 列目を足して移す</button><button>右の欄へ →</button><hr><button>たたむ</button><button>高さを戻す</button></div>');`;
const MORE = '<button class="bmore" title="移す先・たたむ・高さを戻す">⋯</button>';

export const PROPOSALS = [
  {
    key: "G", name: "B を直した物（見出しは名前と数・説明は下の行・⋯ で移す先・太い境目）",
    css: BASE,
    ops: [["script", LIB], ["insert", '<button type="button" class="lay-btn">▥ 画面の配置 ▾</button>', "beforeend", "#modeBar"],
      ["script", `window.__lay = () => __wrap({ tools: '${MORE}' }); window.__alt = () => { ${MENU} ${BMENU("cls")} }; window.__cols = () => __four();`]],
  },
  {
    key: "H", name: "「配置を変える」の間だけ枠と道具が出る（ふだんはすっきり）",
    css: BASE + `.grip,.bmore{display:none}
body.lay-edit .grip,body.lay-edit .bmore{display:inline}
body.lay-edit .blk{outline:2px dashed #7aa0d4;outline-offset:-3px}
body.lay-edit .blk>.bh{background:#e8f0fb}
.lay-bar{position:absolute;left:50%;top:4px;transform:translateX(-50%);z-index:60;display:none;align-items:center;gap:10px;background:#1f3a5f;color:#fff;border-radius:8px;padding:6px 12px;font-size:13px;box-shadow:0 8px 20px rgba(0,0,0,.25)}
body.lay-edit .lay-bar{display:flex}.lay-bar .seg button{font-size:12.5px;padding:2px 8px;background:#fff;color:#1f3a5f}.lay-bar .seg button.on{background:#7fb0ff;color:#0b1f3a}
.lay-bar .done{background:#fff;color:#1f3a5f;border:none;border-radius:5px;padding:3px 12px;font-weight:700}`,
    ops: [["script", LIB], ["insert", '<button type="button" class="lay-btn">▥ 配置を変える</button><div class="lay-bar">欄の数 <span class="seg"><button class="on">左・中・右</button><button>左2列・中・右</button><button>左・中</button><button>中・右</button></span> <span>⠿ で移す・境目で大きさ</span><button class="done">終わる</button></div>', "beforeend", "#modeBar"],
      ["script", `window.__lay = () => __wrap({ tools: '${MORE}' }); window.__alt = () => document.body.classList.add("lay-edit"); window.__cols = () => { document.body.classList.remove("lay-edit"); __four(); };`]],
  },
  {
    key: "I", name: "つかまずに見出しの矢印で移す（← →・↑ ↓）＋境目",
    css: BASE + `.mv{display:inline-flex;gap:2px}.mv button{border:1px solid var(--line);background:var(--pane);color:#4a5a70;border-radius:4px;padding:0 5px;font-size:12px;line-height:18px}`,
    ops: [["script", LIB], ["insert", '<button type="button" class="lay-btn">▥ 欄の数 ▾</button>', "beforeend", "#modeBar"],
      ["script", `window.__lay = () => __wrap({ grip: false, tools: '<span class="mv"><button title="上へ">↑</button><button title="下へ">↓</button><button title="左の欄へ">←</button><button title="右の欄へ">→</button></span>' });
        window.__alt = () => { ${MENU} }; window.__cols = () => __four();`]],
  },
  {
    key: "J", name: "木を短くする（開いた日の近くだけ・残りは「ほか 22 日」）＋境目",
    css: BASE + `.tmore{margin:2px 10px 4px 26px;font-size:12.5px;color:var(--acc);border:1px dashed #b7cbe6;border-radius:4px;padding:2px 8px;display:inline-block}`,
    ops: [["script", LIB], ["insert", '<button type="button" class="lay-btn">▥ 画面の配置 ▾</button>', "beforeend", "#modeBar"],
      ["script", `window.__lay = () => { const ul = document.querySelector("#tree>li>ul"); const items = [...ul.children]; items.slice(4, items.length - 3).forEach((li) => li.remove()); items[3].insertAdjacentHTML("afterend", '<li><span class="tmore">▸ ほかの日 22（押すと全部）</span></li>'); __wrap({ tools: '${MORE}' }); };
        window.__alt = () => { ${MENU} }; window.__cols = () => __four();`]],
  },
  {
    key: "K", name: "欄の端の「＋」で欄を足す・空の欄は受け皿（欄の数を画面の上で）",
    css: BASE + `.coladd{flex:0 0 18px;display:flex;align-items:center;justify-content:center;background:#eef3f9;color:var(--acc);font-weight:700;border-left:1px solid var(--line);border-right:1px solid var(--line);cursor:pointer;font-size:14px}
.coladd:hover{background:var(--accbg)}
#col2 .empty2{margin:10px;border:2px dashed #9fb6d6;border-radius:8px;color:var(--sub);font-size:13px;padding:30px 10px;text-align:center;line-height:1.6}
.colx{border:none;background:none;color:var(--sub);font-size:13px}`,
    ops: [["script", LIB], ["insert", '<div class="coladd" title="ここに欄を足す">＋</div>', "afterend", ".split[data-split=treePane]"],
      ["script", `window.__lay = () => __wrap({ tools: '${MORE}' });
        window.__alt = () => { const a = document.querySelector(".coladd"); a.insertAdjacentHTML("afterend", '<aside id="col2" style="width:260px"><div class="blk"><div class="bh"><b>新しい欄</b><span class="bsp"></span><button class="colx" title="欄を消す（中のブロックは左へ戻る）">×</button></div><div class="empty2">ブロックの見出しの ⠿ を<br>ここへドラッグ</div></div></aside>'); };
        window.__cols = () => { document.getElementById("col2")?.remove(); __four(); };`]],
  },
];
