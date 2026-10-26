// 更新・ショートカット・配布の画面の案（1 回目）。node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-10-26-update-ui.mjs
//
// 今の画面の困りごと（ui-check.mjs で撮った start・lot・info を見て）:
//  1. 版がどこにも出ない（いまの版・新しい版が来ているか・推奨の札が分からない）
//  2. この PC にショートカットが無いことに気づけない（共有の exe をまた開いてしまう）
//  3. 配布（版を置く・配る版を選ぶ・消す・推奨の札）の画面が無い
// 見せる物（どの案も同じ中身）: 版 4.0.0 → 4.0.1 を取り込み済み（推奨: 画像の読み込みの直し）・ショートカットが無い・配布の置き場に 3 版
// 案の方向: 置き場（見出し・下の帯・右の欄）／見せ方（札・帯・面・知らせ）／流れ（押してから開く・常に見える・その場で済む）

export const V = "4.0.1", NOTE = "画像の読み込みの直し";

/** 配布の中身（どの案も同じ。置き場・版の一覧・置く・配る・消す・推奨） */
export const release = (cls = "") => `
<div class="rl ${cls}">
  <div class="rl-head"><b>配布</b><span class="rl-src" title="設定（config.json）の update_source">置き場 \\\\server\\share\\90_Releases\\DefectTrace</span>
    <button type="button" class="primary">ZIP から版を置く…</button><button type="button">確かめる</button></div>
  <table class="rl-t"><thead><tr><th>版</th><th>置いた日時</th><th>大きさ</th><th>状態</th><th></th></tr></thead><tbody>
    <tr><td><b>4.0.2</b></td><td>10/26 09:00 maint</td><td>6.1 MB</td><td><span class="tag new">置いただけ</span></td><td><button type="button">この版を配る</button><button type="button" class="del">消す</button></td></tr>
    <tr class="on"><td><b>4.0.1</b></td><td>10/25 17:30 maint</td><td>6.1 MB</td><td><span class="tag dist">配っている</span><span class="tag rec">推奨: ${NOTE}</span></td><td><button type="button">推奨を外す</button></td></tr>
    <tr><td><b>4.0.0</b></td><td>10/24 10:00 maint</td><td>6.1 MB</td><td><span class="tag me">この PC</span></td><td><button type="button">この版を配る</button><button type="button" class="del">消す</button></td></tr>
  </tbody></table>
  <div class="rl-foot">配る入口: \\\\server\\share\\90_Releases\\DefectTrace\\DefectTrace.exe（新しい PC にはこのアドレスだけを渡します）</div>
</div>`;

/** どの案も使う見た目（配布の表・札・ボタン） */
export const BASE = `
.rl{display:flex;flex-direction:column;gap:8px;font-size:13px}
.rl-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.rl-head b{font-size:15px}
.rl-src{flex:1;color:var(--sub);font:12px Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:120px}
.rl-t{width:100%;border-collapse:collapse}.rl-t th{text-align:left;font-size:12px;color:var(--sub);font-weight:400;border-bottom:1px solid var(--line);padding:4px 6px}
.rl-t td{padding:6px;border-bottom:1px solid var(--line2);white-space:nowrap}.rl-t td:nth-child(4){white-space:normal}.rl-t .tag{margin:1px 4px 1px 0}.rl-t td:last-child{text-align:right}.rl-t td button{margin-left:4px}
.rl-t tr.on td{background:#eef6ee}.rl-t .del{color:var(--ng)}
.tag{display:inline-block;border-radius:10px;padding:0 8px;font-size:12px;margin-right:4px;border:1px solid}
.tag.dist{color:#1b5e20;border-color:#9ccc9c;background:#e8f5e9}.tag.rec{color:#8a5a00;border-color:#ecd9a8;background:#fff6e0}
.tag.me{color:var(--acc);border-color:#b7cbe6;background:var(--accbg)}.tag.new{color:var(--sub);border-color:var(--line)}
.rl-foot{font-size:12px;color:var(--sub)}
.amber{background:#e6a52e!important;border-color:#e6a52e!important;color:#1b2733!important;font-weight:700}
.modal{position:fixed;inset:0;background:rgba(15,25,40,.45);display:none;align-items:flex-start;justify-content:center;padding-top:80px;z-index:50}
body[data-state=release] .modal{display:flex}
.modal>.box{background:var(--pane);border-radius:10px;box-shadow:0 20px 50px rgba(0,0,0,.35);padding:16px 18px;width:min(820px,92vw)}
`;

export const STATES = {
  lot: "",
  release: "document.body.dataset.state='release'",
};

const header = (html) => ["insert", html, "beforebegin", "#btnReset"];

export const PROPOSALS = [
  {
    key: "A", name: "見出しの版の札＋小窓",
    css: BASE + `
.vchip{display:inline-flex;align-items:center;gap:6px;border:1px solid #3d4d66;border-radius:14px;padding:2px 10px;color:#cfd6df;font-size:12px;cursor:pointer;background:transparent}
.vchip .dot{width:8px;height:8px;border-radius:50%;background:#e6a52e}
.pop{position:fixed;top:40px;right:12px;width:min(720px,calc(100vw - 24px));background:var(--pane);border:1px solid var(--line);border-radius:8px;box-shadow:0 12px 32px rgba(0,0,0,.25);padding:12px;z-index:40;display:flex;flex-direction:column;gap:10px}
.pop .row2{display:flex;align-items:center;gap:8px}.pop .row2 span{flex:1}
body:not([data-state=release]) .pop{display:none}`,
    ops: [
      header(`<button type="button" class="vchip"><span class="dot"></span>版 4.0.0 <b style="color:#fff">→ ${V}</b> ・ ショートカットなし ▾</button>`),
      ["insert", `<div class="pop"><div class="row2"><span>新しい版 <b>${V}</b> を取り込みました（推奨: ${NOTE}）</span><button type="button" class="primary">開き直して更新</button></div>
        <div class="row2"><span>この PC にショートカットがありません</span><button type="button">作る</button><button type="button">今後たずねない</button></div>${release()}</div>`, "beforeend", "body"],
    ],
  },
  {
    key: "B", name: "下の帯に知らせ・配布は中央の窓",
    css: BASE + `
footer{gap:8px}.fnote{display:inline-flex;align-items:center;gap:6px;border-radius:4px;padding:1px 8px;font-size:12px}
.fnote.up{background:#fff6e0;border:1px solid #ecd9a8;color:#8a5a00}.fnote.sc{background:var(--accbg);border:1px solid #b7cbe6;color:var(--acc)}
.fnote button{padding:0 6px;font-size:12px}.fnote,.fnote button,footer .mini{white-space:nowrap}footer>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`,
    ops: [
      ["insert", `<span class="fnote up">版 ${V} を取り込み済み（推奨）<button type="button">開き直して更新</button></span><span class="fnote sc">ショートカットがありません<button type="button">作る</button></span><button type="button" class="mini">配布…</button>`, "afterbegin", "footer"],
      ["insert", `<div class="modal"><div class="box">${release()}</div></div>`, "beforeend", "body"],
    ],
  },
  {
    key: "C", name: "見出しの下の帯（バナー）",
    css: BASE + `
.banner{display:flex;flex-direction:column}.bn{display:flex;align-items:center;gap:10px;padding:6px 14px;font-size:13px;border-bottom:1px solid}
.bn.up{background:#fff6e0;border-color:#ecd9a8;color:#5c3d00}.bn.sc{background:var(--accbg);border-color:#b7cbe6;color:#123a6b}.bn span{flex:1}
.bn .x{border:none;background:none;color:inherit;opacity:.6}`,
    ops: [
      header(`<button type="button" class="ghost">配布</button>`),
      ["insert", `<div class="banner"><div class="bn up"><b>↻</b><span>新しい版 <b>${V}</b> を取り込みました。開き直すと入れ替わります（推奨: ${NOTE}）</span><button type="button" class="primary">開き直して更新</button><button type="button">あとで</button></div>
        <div class="bn sc"><b>⌂</b><span>デスクトップとスタートに DefectTrace のショートカットを作りますか（次から共有の exe を探さずに開けます）</span><button type="button" class="primary">作る</button><button type="button">今後たずねない</button></div></div>`, "afterend", "header"],
      ["insert", `<div class="modal"><div class="box">${release()}</div></div>`, "beforeend", "body"],
    ],
  },
  {
    key: "D", name: "右の欄の「アプリ」",
    css: BASE + `
#appBox .ln2{display:flex;align-items:center;gap:6px;padding:4px 2px;border-bottom:1px solid var(--line2)}#appBox .ln2 span{flex:1}
#appBox .rl-t td:nth-child(2),#appBox .rl-t th:nth-child(2),#appBox .rl-t td:nth-child(3),#appBox .rl-t th:nth-child(3){display:none}
#appBox .rl-src{font-size:11px}#appBox .rl-t td:last-child{white-space:normal}#appBox .rl-t td:last-child button{margin:2px 0 2px 4px;white-space:nowrap}
body:not([data-state=release]) #appBox .rl{display:none}`,
    ops: [
      ["insert", `<details class="box" id="appBox" open><summary>アプリ <span class="sub">版 4.0.0</span> <span class="tag rec">更新あり</span></summary>
        <div class="ln2"><span>版 <b>${V}</b> を取り込み済み（推奨: ${NOTE}）</span><button type="button" class="primary">開き直す</button></div>
        <div class="ln2"><span>ショートカットがありません</span><button type="button">作る</button></div>
        <div class="ln2"><span>配布（置き場の版 3）</span><button type="button">開く ▾</button></div>${release()}</details>`, "afterbegin", "#infoPane"],
    ],
  },
  {
    key: "E", name: "右下の知らせ＋右から出る面",
    css: BASE + `
.toast{position:fixed;right:16px;bottom:40px;width:380px;background:#1f2a3a;color:#fff;border-radius:8px;padding:12px 14px;box-shadow:0 10px 30px rgba(0,0,0,.35);display:flex;flex-direction:column;gap:8px;z-index:30}
.toast .act{display:flex;gap:6px;justify-content:flex-end}.toast button{background:transparent;color:#fff;border-color:#55667f}
.drawer{position:fixed;top:0;right:0;bottom:0;width:720px;background:var(--pane);box-shadow:-12px 0 30px rgba(0,0,0,.25);padding:16px;display:flex;flex-direction:column;gap:14px;z-index:45}
.drawer h3{margin:0;font-size:15px}.drawer .sec{display:flex;align-items:center;gap:8px}.drawer .sec span{flex:1}
body:not([data-state=release]) .drawer{display:none}`,
    ops: [
      header(`<button type="button" class="ghost">⚙ 版と配布</button>`),
      ["insert", `<div class="toast"><div>新しい版 <b>${V}</b> を取り込みました<br><small>推奨: ${NOTE}</small></div><div>ショートカットがありません</div><div class="act"><button type="button">ショートカットを作る</button><button type="button" class="amber">開き直して更新</button></div></div>`, "beforeend", "body"],
      ["insert", `<div class="drawer"><h3>版と配布</h3><div class="sec"><span>この PC の版 4.0.0 ・ 取り込み済み ${V}</span><button type="button" class="primary">開き直して更新</button></div>
        <div class="sec"><span>ショートカット: なし</span><button type="button">作る</button></div>${release()}</div>`, "beforeend", "body"],
    ],
  },
  {
    key: "F", name: "札の色で状態＋1 回だけの帯＋配布の窓",
    css: BASE + `
.vchip{display:inline-flex;align-items:center;gap:6px;border-radius:14px;padding:3px 12px;font-size:12px;cursor:pointer}
.bn{display:flex;align-items:center;gap:10px;padding:6px 14px;font-size:13px;border-bottom:1px solid #b7cbe6;background:var(--accbg);color:#123a6b}.bn span{flex:1}`,
    ops: [
      header(`<button type="button" class="vchip amber" title="推奨: ${NOTE}">↻ ${V} に更新（開き直す）</button><span style="color:#8b98a9;font-size:12px">版 4.0.0</span><button type="button" class="ghost">配布</button>`),
      ["insert", `<div class="bn"><span>デスクトップとスタートにショートカットを作りますか（次から共有の exe を探さずに開けます）</span><button type="button" class="primary">作る</button><button type="button">今後たずねない</button></div>`, "afterend", "header"],
      ["insert", `<div class="modal"><div class="box">${release()}</div></div>`, "beforeend", "body"],
    ],
  },
];
