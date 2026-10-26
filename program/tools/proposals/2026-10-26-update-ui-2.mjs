// 更新・ショートカット・配布の画面の案（2 回目）。1 回目（2026-10-26-update-ui.mjs）は 1 位 F が 76.1 点で 80 点に届かなかった。
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-10-26-update-ui-2.mjs
//
// 1 回目の採点で低かった所と、この回で直す所:
//  - 推奨の理由が title にしか無い（状態が見えない −3）→ 理由を札の隣に常に出す
//  - 主ボタンの色が 2 系統（更新の橙・ショートカットの青）で、どちらも「押すべき」に見える → 主は更新の橙だけ。ショートカットは従（白地に枠）
//  - いまの版が暗い見出しの中で読みにくい → 「4.0.0 → 4.0.1」を 1 つの塊で
//  - 配布の窓に閉じる × が無い → 窓の頭に × と Esc
//  - 帯が 2 本で本体が 95px 下がる（C）→ 帯は 1 本・細く、または無し
// 持ち越し: F（札の色で状態）・C（帯）。新しい案: H・I・J
import { release, BASE, V, NOTE } from "./2026-10-26-update-ui.mjs";

const MODAL = `
.mhead{display:flex;align-items:center;gap:8px;margin:-4px 0 8px}.mhead b{font-size:16px;flex:1}
.mclose{border:none;background:none;font-size:20px;line-height:20px;padding:2px 8px;color:var(--sub);border-radius:6px}.mclose:hover{background:var(--line2);color:var(--txt)}
.rl-head b{display:none}`;
const modal = `<div class="modal"><div class="box" role="dialog" aria-label="配布"><div class="mhead"><b>配布</b><span class="sub">版を置く・配る版を選ぶ・推奨の札</span><button type="button" class="mclose" title="閉じる（Esc）">×</button></div>${release()}</div></div>`;
// 見出しの版の塊: いまの版 → 取り込んだ版（橙の主ボタン）＋推奨の理由
const VER = `
.vgrp{display:inline-flex;align-items:center;gap:8px;white-space:nowrap}
.vnow{color:#e8eef5;font:600 12px Consolas,monospace;letter-spacing:.02em}
.vbtn{display:inline-flex;align-items:center;gap:6px;border-radius:14px;padding:3px 12px;font-size:12.5px;background:#e6a52e;border:1px solid #e6a52e;color:#1b2733;font-weight:700}
.vwhy{display:inline-flex;align-items:center;border-radius:10px;padding:1px 8px;font-size:12px;background:#3a3020;color:#f3d79a;border:1px solid #6b5527}
.ghost2{background:transparent;color:#e8eef5;border:1px solid #55667f;font-size:12px;border-radius:4px;padding:3px 10px}
.sec2{background:var(--pane);color:var(--acc);border:1px solid #b7cbe6}`;
const verGroup = `<span class="vgrp"><span class="vnow">版 4.0.0 →</span><button type="button" class="vbtn">↻ ${V} に更新</button><span class="vwhy">推奨: ${NOTE}</span></span>`;
const header = (html) => ["insert", html, "beforebegin", "#btnReset"];

export const STATES = { lot: "", release: "document.body.dataset.state='release'" };

export const PROPOSALS = [
  {
    key: "F2", name: "札の色で状態＋細い 1 回だけの帯（F を直した）",
    css: BASE + MODAL + VER + `
.bn{display:flex;align-items:center;gap:10px;padding:4px 14px;font-size:13px;border-bottom:1px solid #d6e1ef;background:#f3f7fc;color:#123a6b;white-space:nowrap}.bn span{flex:1;overflow:hidden;text-overflow:ellipsis}
.bn button{padding:2px 10px}.bn .lnk{border:none;background:none;color:var(--sub);text-decoration:underline}`,
    ops: [
      header(`${verGroup}<button type="button" class="ghost2">配布</button>`),
      ["insert", `<div class="bn"><b>⌂</b><span>デスクトップとスタートにショートカットを作りますか（次から共有の exe を探さずに開けます）</span><button type="button" class="sec2">作る</button><button type="button" class="lnk">今後たずねない</button></div>`, "afterend", "header"],
      ["insert", modal, "beforeend", "body"],
    ],
  },
  {
    key: "C2", name: "1 本の帯にまとめる（C を直した）",
    css: BASE + MODAL + VER + `
.bn{display:flex;align-items:center;gap:10px;padding:5px 14px;font-size:13px;border-bottom:1px solid #ecd9a8;background:#fff8e8;color:#4a3300;white-space:nowrap}
.bn .msg{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}.bn .sep{width:1px;align-self:stretch;background:#ecd9a8}
.bn .sc{display:inline-flex;align-items:center;gap:8px;color:#123a6b}.bn .lnk{border:none;background:none;color:var(--sub);text-decoration:underline;padding:0 4px}`,
    ops: [
      header(`<span class="vnow">版 4.0.0</span><button type="button" class="ghost2">配布</button>`),
      ["insert", `<div class="bn"><b>↻</b><span class="msg">新しい版 <b>${V}</b> を取り込みました（推奨: ${NOTE}）。開き直すと入れ替わります</span><button type="button" class="vbtn">開き直して更新</button><span class="sep"></span>
        <span class="sc">⌂ ショートカットがありません<button type="button" class="sec2">作る</button><button type="button" class="lnk">今後たずねない</button></span></div>`, "afterend", "header"],
      ["insert", modal, "beforeend", "body"],
    ],
  },
  {
    key: "H", name: "帯を出さず、見出しの札だけで両方",
    css: BASE + MODAL + VER + `
.scchip{display:inline-flex;align-items:center;gap:4px;border:1px dashed #7d8da3;border-radius:14px;padding:2px 4px 2px 10px;font-size:12px;color:#e8eef5;background:transparent;white-space:nowrap}
.scchip .x{border:none;background:none;color:#9aa8ba;padding:0 4px;font-size:14px}`,
    ops: [
      header(`${verGroup}<span class="scchip" title="デスクトップとスタートにショートカットを作ります">⌂ ショートカットを作る<button type="button" class="x" title="今後たずねない">×</button></span><button type="button" class="ghost2">配布</button>`),
      ["insert", modal, "beforeend", "body"],
    ],
  },
  {
    key: "I", name: "版の札から開く小窓（更新・ショートカット・配布を 1 か所に）",
    css: BASE + MODAL + VER + `
.vmenu{display:inline-flex;align-items:center;gap:8px;border-radius:14px;padding:3px 6px 3px 12px;background:#2c3a4f;border:1px solid #55667f;color:#e8eef5;font-size:12.5px;white-space:nowrap}
.vmenu .vbtn{padding:1px 10px}
.pop{position:fixed;top:40px;right:150px;width:500px;background:var(--pane);border:1px solid var(--line);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.25);padding:12px 14px;z-index:40;display:flex;flex-direction:column;gap:10px}
.pop .r{display:flex;align-items:center;gap:8px}.pop .r span{flex:1}.pop h4{margin:0;font-size:13px;color:var(--sub);font-weight:400}
body[data-state=release] .pop{display:none}`,
    ops: [
      header(`<span class="vmenu">版 4.0.0 → <button type="button" class="vbtn">↻ ${V}</button>▾</span><button type="button" class="ghost2">配布</button>`),
      ["insert", `<div class="pop"><h4>版と更新</h4><div class="r"><span><b>${V}</b> を取り込みました<br><span class="tag rec">推奨: ${NOTE}</span></span><button type="button" class="vbtn">開き直して更新</button></div>
        <div class="r"><span>⌂ ショートカットがありません</span><button type="button" class="sec2">作る</button><button type="button">今後たずねない</button></div>
        <div class="r"><span class="sub">配る置き場 \\\\server\\share\\90_Releases</span><button type="button">配布…</button></div></div>`, "beforeend", "body"],
      ["insert", modal, "beforeend", "body"],
    ],
  },
  {
    key: "J", name: "見出しの札＋木の上の 1 回だけの案内",
    css: BASE + MODAL + VER + `
.tipbox{margin:6px 8px 0;border:1px solid #b7cbe6;background:#f3f7fc;border-radius:8px;padding:8px 10px;font-size:12.5px;color:#123a6b;display:flex;flex-direction:column;gap:6px}
.tipbox .r{display:flex;gap:6px;justify-content:flex-end}.tipbox .lnk{border:none;background:none;color:var(--sub);text-decoration:underline}`,
    ops: [
      header(`${verGroup}<button type="button" class="ghost2">配布</button>`),
      ["insert", `<div class="tipbox"><div><b>⌂ ショートカット</b> デスクトップとスタートに作ると、次から共有の exe を探さずに開けます</div><div class="r"><button type="button" class="lnk">今後たずねない</button><button type="button" class="sec2">作る</button></div></div>`, "afterbegin", "#treePane"],
      ["insert", modal, "beforeend", "body"],
    ],
  },
];
