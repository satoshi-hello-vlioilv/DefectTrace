// 画像一覧のスクロールの評価関数: 一覧を上から下まで 40 回に分けて送り、送るたびに全体の長さ（scrollHeight）がどれだけ変わるかを測る。
// 変わると、スクロールバーのつまみがマウスに付いてこない（版 4.14.0 で直した。change と maxJump が 0 なら合格）。
//   cd desktop && cargo xtask fixture <場所> --bench 20 256 260   （CAB 20 個 × 100 枚の大きなロット）
//   node program/tools/scroll-check.mjs <場所>/LS3/2026/2026_10/2026_10_26/2026_10_26_10_00_00 [幅] [高さ] [win]
// win: Windows の書体の行の高さを模す（カードの項目の行 15→18px・見出し 12→16px）。式でカードの高さを見積もっていた頃は、ここで大きくずれた
import { launch, walk } from "./ui-harness.mjs";
const [lotdir, w = 1728, h = 1152] = [process.argv[2], +(process.argv[3] || 1728), +(process.argv[4] || 1152)];
process.env.DT_UI_MORE = JSON.stringify([{ name: "BENCH", path: lotdir.split("/LS3/")[0] + "/LS3" }]); process.env.DT_UI_LOT = lotdir;
const app = await launch();
try {
  const page = await app.newPage({ width: w, height: h });
  await walk(page, async () => {}, ["lot"]);
  // 4 つ目の引数 "win": Windows の書体の行の高さを作る（項目の行 15→18px・見出し 12→16px。字の大きさは同じ）
  if (process.argv[5] === "win") await page.addStyleTag({ content: ".th .rw{line-height:18px!important}.th legend{line-height:16px}" });
  const r = await page.evaluate(async () => {
    const g = document.getElementById("grid"), wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 100 && (!g.querySelectorAll(".th").length || document.querySelector(".lpband3:not([hidden])")); i++) await wait(200);
    await wait(1500);
    const n = g.querySelectorAll(".th").length, H0 = g.scrollHeight, steps = [];
    let maxJump = 0;
    for (let i = 1; i <= 40; i++) {
      const before = g.scrollHeight;
      g.scrollTop = (g.scrollHeight - g.clientHeight) * i / 40;
      await wait(120);
      const after = g.scrollHeight; maxJump = Math.max(maxJump, Math.abs(after - before)); steps.push(after - before);
    }
    const ths = [...g.querySelectorAll(".th")].filter((t) => t.firstChild);
        const real = ths.slice(0, 5).map((t) => t.offsetHeight);
    return { cardH: g.style.getPropertyValue("--cardH"), hist: Object.entries([...g.querySelectorAll(".th")].filter((t) => t.firstChild).reduce((m, t) => (m[t.getBoundingClientRect().height] = (m[t.getBoundingClientRect().height] || 0) + 1, m), {})), cards: n, H0, H1: g.scrollHeight, change: g.scrollHeight - H0, maxJump, real, rows: getComputedStyle(g).getPropertyValue("--rows"), ts: getComputedStyle(g).getPropertyValue("--ts") };
  });
  console.log(JSON.stringify(r));
} finally { await app.close(); }
