// 機能ブロックの配置（ロット・仕分け・画像情報・MAP・ロット情報）を利用者が変えられるようにする案（1 回目）:
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-11-02-layout.mjs
//
// 今の困りごと（今の画面を撮った画像で見えたこと。木が長い〈本物のデータのように日のフォルダが多い〉とき）:
//  - 左の欄は木が大半を取り、仕分けは底に押し込まれる（1280: 2 つ目のグループと「＋ グループを作る」が切れ、「一覧の並び」が見えない）
//  - 木と仕分けの境目を動かせない・どちらかをたたむこともできない。ブロックを別の欄へ移す手もない
// 案の方向: 減らし方（A: 境目＋たたむ）・自由度（B: つかんで移す＋欄の数）・見せ方（C: 欄の中のタブ）・置き場（D: 仕分けの欄を足す・E: 右の欄へ）・流れ（F: 形を選ぶ）
//   lot: ロットを開いた画面（木が長い）・alt: 案の 2 つ目の様子（メニューを開いた・移している最中・タブを切り替えた など）

export const SETUP = `return fetch("/api/classes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({groups:[{id:"a",name:"黒点",examples:[]},{id:"b",name:"スジ",examples:[]}]})})`;
const LONG = `const eq = document.querySelector("#tree>li"); const ul = eq.querySelector(":scope>ul") || eq.appendChild(document.createElement("ul"));
  for (let i = 0; i < 26; i++) ul.insertAdjacentHTML("afterbegin", '<li><div class="row"><span class="tw">▶</span><span class="nm">2026/' + String(10 - (i % 3)).padStart(2,"0") + "/" + String(28 - i).padStart(2, "0") + ' (月)</span><span class="cnt">' + (3 + i % 5) + 'ロット</span></div></li>');`;
const WAIT = `new Promise((r) => setTimeout(r, 400))`;
export const STATES = {
  lot: `${LONG} if (window.__lay) window.__lay(); return ${WAIT}`,
  alt: `if (window.__alt) window.__alt(); return ${WAIT}`,
};

// ブロックの殻: 見出し（つかむ所・名前・数・たたむ）と中身
const LIB = `window.__blk = (key, title, nodes, o = {}) => { const s = document.createElement("section"); s.className = "blk"; s.dataset.blk = key;
  s.innerHTML = '<div class="bh">' + (o.grip === false ? "" : '<span class="grip" title="つかんで移す">⠿</span>') + '<span class="tw2">▾</span><b>' + title + '</b><span class="bsub">' + (o.sub || "") + '</span><span class="bsp"></span>' + (o.tools || "") + '</div><div class="bb"></div>';
  nodes.forEach((n) => s.querySelector(".bb").append(n)); return s; };
  window.__wrapLeft = (o = {}) => { const p = document.getElementById("treePane");
  const t = __blk("tree", "ロット", [p.querySelector(".pane-head"), document.getElementById("tree"), p.querySelector(".nb-leg")], { sub: "LS3 ・ DL2", grip: o.grip });
  const c = __blk("cls", "仕分け", [document.getElementById("clsPane")], { sub: "カードをグループへドラッグ・行を押すと絞る", grip: o.grip }); p.append(t); if (o.split !== false) p.insertAdjacentHTML("beforeend", '<div class="hsplit" title="ドラッグで高さを変える"></div>'); p.append(c); return [t, c]; };`;
const BASE = `#treePane{padding:0;gap:0}
.blk{display:flex;flex-direction:column;min-height:0;background:var(--pane)}
.blk>.bh{flex:none;display:flex;align-items:center;gap:6px;padding:5px 8px 5px 6px;border-bottom:1px solid var(--line2);background:#f5f8fc;font-size:13px;color:var(--acc)}
.blk>.bh b{font-weight:700;white-space:nowrap}.bsub{color:var(--sub);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}.bsp{flex:1}
.grip{cursor:grab;color:#7a8799;font-size:14px;letter-spacing:-1px;padding:0 2px}
.tw2{font-size:11px;color:var(--acc);width:12px;text-align:center}
.blk>.bb{flex:1;min-height:0;display:flex;flex-direction:column;overflow:auto}
.blk[data-blk=tree]>.bb>#tree{flex:1 1 auto;min-height:0}
.blk .cls-pane{border-top:none;overflow:visible;flex:none}
.blk .cls-head{display:none}
.blk .nb-leg{margin-top:0;flex:none}
.hsplit{flex:0 0 6px;cursor:row-resize;background:var(--line);position:relative}
.hsplit::after{content:"";position:absolute;left:50%;top:2px;width:28px;height:2px;margin-left:-14px;border-top:1px solid #9fb0c6;border-bottom:1px solid #9fb0c6;box-sizing:border-box;height:4px;top:1px}
.lay-btn{margin-left:auto;align-self:center;border:1px solid #b7cbe6;background:var(--pane);color:var(--acc);border-radius:5px;padding:3px 10px;font-size:13px;white-space:nowrap}
#modeBar{display:flex;align-items:flex-end;padding-right:12px}`;

export const PROPOSALS = [
  {
    key: "A", name: "境目を動かす＋たたむ（左の欄の中を上下に分ける）",
    css: BASE + `.blk[data-blk=tree]{flex:0 0 46%}.blk[data-blk=cls]{flex:1 1 0}`,
    ops: [["script", LIB], ["script", `window.__lay = () => __wrapLeft({ grip: false });
      window.__alt = () => { const t = document.querySelector('.blk[data-blk=tree]'); t.style.flex = "none"; t.querySelector(".bb").style.display = "none"; t.querySelector(".tw2").textContent = "▸"; };`]],
  },
  {
    key: "B", name: "ブロックをつかんで移す・境目で大きさ・「画面の配置」で欄の数",
    css: BASE + `.blk[data-blk=tree]{flex:0 0 46%}.blk[data-blk=cls]{flex:1 1 0}
#infoPane .box>summary::before{content:"⠿";color:#7a8799;margin-right:6px;cursor:grab;letter-spacing:-1px}
.lay-menu{position:absolute;right:12px;top:calc(100% + 4px);z-index:60;width:480px;background:var(--pane);border:1px solid var(--line);border-radius:8px;box-shadow:0 12px 30px rgba(0,0,0,.18);padding:12px 14px;display:flex;flex-direction:column;gap:10px;font-size:13px}
.lay-menu h5{margin:0;font-size:12px;color:var(--sub);font-weight:600}
.lay-opts{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.lay-opt{border:1px solid var(--line);border-radius:6px;padding:6px;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:12px;background:var(--pane)}
.lay-opt.on{border:2px solid var(--acc);background:var(--accbg)}
.lay-ic{display:flex;gap:2px;width:64px;height:38px}.lay-ic i{background:#c9d6e8;border-radius:2px}.lay-ic i.c{background:#eef2f7;border:1px solid #c9d6e8;flex:1}
.lay-hint{color:var(--sub);font-size:12px;line-height:1.5}
.drop-line{height:0;border-top:3px solid var(--acc);margin:-2px 4px;position:relative}.drop-line::before{content:"ここへ移す";position:absolute;right:6px;top:-12px;font-size:12px;background:var(--acc);color:#fff;border-radius:4px;padding:0 6px}
.lay-ghost{position:fixed;z-index:70;opacity:.9;width:300px;border:2px solid var(--acc);border-radius:6px;box-shadow:0 10px 24px rgba(0,0,0,.25)}`,
    ops: [["script", LIB], ["insert", '<button type="button" class="lay-btn" id="layBtn">▥ 画面の配置 ▾</button>', "beforeend", "#modeBar"],
      ["script", `window.__lay = () => __wrapLeft();
      window.__alt = () => { const ic = (l) => '<span class="lay-ic">' + l.map((w) => w ? '<i style="flex:0 0 ' + w + 'px"></i>' : '<i class="c"></i>').join("") + '</span>';
        document.getElementById("modeBar").style.position = "relative";
        document.getElementById("modeBar").insertAdjacentHTML("beforeend", '<div class="lay-menu"><h5>欄の数（ブロックは見出しの ⠿ をつかんで欄の間を移せます）</h5><div class="lay-opts">'
          + '<button class="lay-opt on">' + ic([14, 0, 14]) + '左・中・右</button><button class="lay-opt">' + ic([10, 10, 0, 14]) + '左2列・中・右</button><button class="lay-opt">' + ic([14, 0]) + '左・中</button><button class="lay-opt">' + ic([0, 14]) + '中・右</button></div>'
          + '<h5>よく使う形</h5><div class="lay-opts"><button class="lay-opt">標準</button><button class="lay-opt">仕分けを広く</button><button class="lay-opt">画像を大きく</button><button class="lay-opt">元に戻す</button></div>'
          + '<div class="lay-hint">境目（━）をドラッグで高さ・幅を変える。見出しを押すとたたむ。配置はこの PC に残ります</div></div>');
        const box = document.querySelectorAll("#infoPane>.box")[1]; box.insertAdjacentHTML("beforebegin", '<div class="drop-line"></div>');
        const g = document.querySelector('.blk[data-blk=cls]>.bh').cloneNode(true); const gh = document.createElement("div"); gh.className = "lay-ghost blk"; gh.append(g); const r = box.getBoundingClientRect(); gh.style.left = (r.left - 40) + "px"; gh.style.top = (r.top - 24) + "px"; document.body.append(gh); };`]],
  },
  {
    key: "C", name: "左の欄の中のタブ（ロット｜仕分け）",
    css: BASE + `.ltabs{flex:none;display:flex;border-bottom:1px solid var(--line);background:#f5f8fc}
.ltabs button{flex:1;border:none;background:none;padding:7px 8px;font-size:13px;color:var(--sub);border-bottom:3px solid transparent}
.ltabs button.on{color:var(--acc);font-weight:700;border-bottom-color:var(--acc);background:var(--pane)}
.ltabs .n{display:inline-block;margin-left:4px;font-size:11px;background:#e3e9f3;color:#36506f;border-radius:8px;padding:0 6px}
.blk>.bh{display:none}.blk{flex:1 1 0}.blk[hidden]{display:none}`,
    ops: [["script", LIB], ["script", `window.__lay = () => { const [t, c] = __wrapLeft({ split: false }); c.hidden = true;
        t.before(Object.assign(document.createElement("div"), { className: "ltabs", innerHTML: '<button class="on">ロット</button><button>仕分け<span class="n">2</span></button>' })); };
      window.__alt = () => { const b = document.querySelectorAll(".ltabs button"); b[0].className = ""; b[1].className = "on"; document.querySelector('.blk[data-blk=tree]').hidden = true; document.querySelector('.blk[data-blk=cls]').hidden = false; };`]],
  },
  {
    key: "D", name: "仕分けを専用の欄に（左・仕分け・中・右の 4 欄）",
    css: BASE + `#clsCol{width:300px;min-width:220px;border-left:none}#clsCol>.blk{flex:1}`,
    ops: [["script", LIB], ["insert", '<aside id="clsCol"></aside><div class="split" title="ドラッグで幅を変更"></div>', "afterend", ".split[data-split=treePane]"],
      ["script", `window.__lay = () => { const [t, c] = __wrapLeft({ split: false, grip: false }); t.style.flex = "1"; document.getElementById("clsCol").append(c); document.getElementById("treePane").style.width = "260px"; };`]],
  },
  {
    key: "E", name: "仕分けを右の欄の先頭へ（右のブロックはたためる）",
    css: BASE + `.blk[data-blk=tree]{flex:1}#infoPane>.blk{border:1px solid var(--line);border-radius:6px;flex:none}
#infoPane>.blk>.bh{border-radius:6px 6px 0 0}`,
    ops: [["script", LIB], ["script", `window.__lay = () => { const [t, c] = __wrapLeft({ split: false, grip: false }); document.getElementById("infoPane").prepend(c); };
      window.__alt = () => { document.querySelectorAll("#infoPane>details.box").forEach((d, i) => { if (i < 2) d.open = false; }); };`]],
  },
  {
    key: "F", name: "形を選ぶ（標準・仕分けを広く・画像を大きく）",
    css: BASE + `.lay-seg{margin-left:auto;align-self:center;display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--sub)}
.lay-seg .seg button{font-size:12.5px;padding:2px 10px}
body.lay-cls .blk[data-blk=tree]{flex:0 0 30%}body.lay-cls .blk[data-blk=cls]{flex:1 1 0}
body.lay-big #infoPane,body.lay-big .split[data-split=infoPane]{display:none!important}body.lay-big .blk[data-blk=tree]{flex:1}`,
    ops: [["script", LIB], ["insert", '<div class="lay-seg">画面の形 <span class="seg"><button type="button">標準</button><button type="button" class="on">仕分けを広く</button><button type="button">画像を大きく</button></span></div>', "beforeend", "#modeBar"],
      ["script", `window.__lay = () => { __wrapLeft({ split: false, grip: false }); document.body.classList.add("lay-cls"); };
      window.__alt = () => { document.body.classList.remove("lay-cls"); document.body.classList.add("lay-big"); const b = document.querySelectorAll(".lay-seg button"); b[1].className = ""; b[2].className = "on"; };`]],
  },
];
