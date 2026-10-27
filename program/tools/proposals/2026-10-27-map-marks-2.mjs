// MAP の欠陥の記号の案（2 回目）。撮り方は 1 回目（2026-10-27-map-marks.mjs）と同じ（欠陥の多いロット 7,016 点と少ないロット 58 点）。
//
// 1 回目は 1 位 M3 が 75.4 点で 80 点に届かなかった。採点で低かった所と、この回で直す所:
//  - 記号を点にすると ▲■★ の形が消え、分類が色だけ（−2）・凡例は ▲■★ のままで図と食い違う
//    → 描き方を直した: 分類の形を小さな図形（● ▲ ■ ★ ◆）で描く（2px でも 3px でも形が残る）。凡例も図と同じ図形で描く
//  - 既定の大きさ・濃さが、多いロットと少ないロットの両方には合わない（多いと塊・少ないと消える）
//    → 自動（見えている点の数で決める: 300 未満 7px・85%／2,000 未満 4px・55%／8,000 未満 2.5px・30%／それ以上 1.5px・20%）を既定に
//  - 塗り＋輪郭（両方）・濃さの細かい調整が無い（M3）→ 見え方に「塗り＋輪郭」、濃さはつまみで
//  - 小窓が MAP を覆う（M2）・凡例が折れる（M5）→ どの案も MAP の段の中だけで、覆わない
//  - 画像の無い欠陥の灰色が背景に溶ける → 灰色を濃く（95）・濃さの割り引きを 0.7 に
// 持ち越し: M3（段の部品）・M6（自動）。新しい案: M7・M8・M9

const set = (o) => ["script", `window.dtSetMark(${JSON.stringify(o)});`];
const bar = (html) => ["script", `document.querySelector(".mapbar").querySelector("label.fld").outerHTML = ${JSON.stringify(html)};`];
const BASE = `
.mk-seg{display:inline-flex;border:1px solid var(--line);border-radius:5px;overflow:hidden}
.mk-seg button{border:none;border-right:1px solid var(--line);border-radius:0;background:var(--pane);padding:2px 8px;font-size:12px;color:var(--txt);white-space:nowrap}
.mk-seg button:last-child{border-right:none}.mk-seg button.on{background:var(--acc);color:#fff}
.mk-fld{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--sub);white-space:nowrap}
.mk-fld input[type=range]{width:84px;margin:0;height:16px}.mk-fld b{color:var(--txt);font-weight:600;min-width:34px}
.mk-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;width:100%}
.mapbar{flex-wrap:wrap;row-gap:6px}`;
// 自動の答えを、見えている点の数から（app.js の autoMark と同じ境目）
const AUTO = `const n = parseInt(document.getElementById("mapTitle").textContent) || 0;
  const a = n < 300 ? [7, 85] : n < 2000 ? [4, 55] : n < 8000 ? [2.5, 30] : [1.5, 20];`;

export const STATES = { lot: "" };

export const PROPOSALS = [
  {
    key: "M3b", name: "段の部品（自動・極小・小・中・大 × 濃い・半透明・輪郭・塗り＋輪郭）。既定は自動・半透明。分類の形を小さな図形で",
    css: BASE,
    ops: [set({ auto: true, shape: "kind", look: "fill" }),
      bar(`<div class="mk-row"><span class="mk-fld">大きさ <span class="mk-seg"><button class="on">自動</button><button>極小</button><button>小</button><button>中</button><button>大</button></span></span></div>
<div class="mk-row"><span class="mk-fld">見え方 <span class="mk-seg"><button>濃い</button><button class="on">半透明</button><button>輪郭</button><button>塗り＋輪郭</button></span></span></div>`)],
  },
  {
    key: "M6b", name: "自動（点の数で大きさ・濃さ）を既定に、つまみを動かすと手で（自動の答えをつまみに出す・薄くしない）",
    css: BASE,
    ops: [set({ auto: true, shape: "kind", look: "fill" }),
      ["script", `${AUTO}
        document.querySelector(".mapbar").querySelector("label.fld").outerHTML = '<div class="mk-row"><label class="mk-fld"><input type="checkbox" checked> 自動（点 ' + n + ' 個に合わせる）</label>'
          + '<span class="mk-fld">大きさ <input type="range" min="1" max="28" value="' + a[0] + '"><b>' + a[0] + 'px</b></span>'
          + '<span class="mk-fld">濃さ <input type="range" min="5" max="100" value="' + a[1] + '"><b>' + a[1] + '%</b></span></div>'
          + '<div class="mk-row"><span class="mk-fld">描き方 <span class="mk-seg"><button class="on">塗り</button><button>輪郭</button><button>塗り＋輪郭</button></span></span></div>';`]],
  },
  {
    key: "M7", name: "自動＋大きさ・濃さのつまみ 2 本＋描き方の段＋「自動に戻す」（つまみは常に効く。動かすと自動が外れ、戻すボタンが出る）",
    css: BASE + `.mk-auto{border:1px solid #9ccc9c;background:#e8f5e9;color:#1b5e20;border-radius:10px;padding:0 8px;font-size:11.5px;font-weight:600}`,
    ops: [set({ auto: true, shape: "kind", look: "fill" }),
      ["script", `${AUTO}
        document.querySelector(".mapbar").querySelector("label.fld").outerHTML = '<div class="mk-row"><span class="mk-fld">大きさ <input type="range" min="1" max="28" value="' + a[0] + '"><b>' + a[0] + 'px</b></span>'
          + '<span class="mk-fld">濃さ <input type="range" min="5" max="100" value="' + a[1] + '"><b>' + a[1] + '%</b></span><span class="mk-auto" title="点の数に合わせて決めています。つまみを動かすと手で決めます">自動</span></div>'
          + '<div class="mk-row"><span class="mk-fld">描き方 <span class="mk-seg"><button class="on">塗り</button><button>輪郭</button><button>塗り＋輪郭</button></span></span><span class="mk-fld">形 <span class="mk-seg"><button class="on">分類</button><button>点</button></span></span></div>';`]],
  },
  {
    key: "M8", name: "密度の地（重なりの数で青く塗る）＋極小の点を重ねる。「点・密度」の段で切り替え（既定は 2,000 点を超えたら密度＋点）",
    css: BASE + `.mk-scale{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--sub)}
.mk-scale i{display:inline-block;width:70px;height:10px;border-radius:2px;background:linear-gradient(90deg,rgba(30,70,140,.12),rgba(30,70,140,.9))}`,
    ops: [["script", `${AUTO}
        const dense = n >= 2000;
        window.dtSetMark({ auto: true, shape: "kind", look: "fill", density: dense });
        document.querySelector(".mapbar").querySelector("label.fld").outerHTML = '<div class="mk-row"><span class="mk-fld">見せ方 <span class="mk-seg"><button' + (dense ? '' : ' class="on"') + '>点</button><button' + (dense ? ' class="on"' : '') + '>密度＋点</button></span></span>'
          + '<span class="mk-fld">大きさ <input type="range" min="1" max="28" value="' + a[0] + '"><b>' + a[0] + 'px</b></span></div>'
          + (dense ? '<div class="mk-row"><span class="mk-scale" title="4px 四方に何個の欠陥が重なっているか">密度 少ない <i></i> 多い</span></div>' : '');`]],
  },
  {
    key: "M9", name: "見本つきの段: 大きさ・見え方の各ボタンに、その設定で描いた小さな見本（押す前に結果が分かる）。既定は自動",
    css: BASE + `.mk-seg button img{display:block;margin:0 auto 1px;width:30px;height:14px}.mk-seg button{padding:2px 7px;font-size:11.5px;line-height:1.15}`,
    ops: [set({ auto: true, shape: "kind", look: "fill" }),
      ["script", `const ic = (size, alpha, look) => { const c = document.createElement("canvas"); c.width = 30; c.height = 14; const g = c.getContext("2d");
          [[8, 7, "#c62828"], [15, 6, "#1565c0"], [21, 8, "#2e7d32"]].forEach(([x, y, col]) => { g.globalAlpha = alpha; g.fillStyle = g.strokeStyle = col; g.beginPath(); g.arc(x, y, Math.max(0.6, size / 2), 0, 7); if (look !== "line") g.fill(); if (look !== "fill") { g.globalAlpha = 1; g.stroke(); } });
          return '<img src="' + c.toDataURL() + '">'; };
        const btn = (on, label, size, alpha, look) => '<button' + (on ? ' class="on"' : '') + '>' + ic(size, alpha, look) + label + '</button>';
        document.querySelector(".mapbar").querySelector("label.fld").outerHTML = '<div class="mk-row"><span class="mk-fld">大きさ <span class="mk-seg">' + btn(1, "自動", 4, .6, "fill") + btn(0, "極小", 1.5, .6, "fill") + btn(0, "小", 3, .6, "fill") + btn(0, "中", 6, .6, "fill") + btn(0, "大", 10, .6, "fill") + '</span></span></div>'
          + '<div class="mk-row"><span class="mk-fld">見え方 <span class="mk-seg">' + btn(0, "濃い", 7, 1, "fill") + btn(1, "半透明", 7, .45, "fill") + btn(0, "輪郭", 7, 1, "line") + btn(0, "塗り＋輪郭", 7, .45, "both") + '</span></span></div>';`]],
  },
];
