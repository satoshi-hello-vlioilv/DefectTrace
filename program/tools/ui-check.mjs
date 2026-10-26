// 画面の撮影と測定（画面を直す前と後で同じ物差しで比べる。決め方は CLAUDE.md）。
//
//   node program/tools/ui-check.mjs 出力フォルダ [1728x1152,1536x864,1280x720]
//
// 状態ごと（start: 起動直後・lot: ロットを開いた・info: 画像を原寸で開いた）に撮り（状態-幅.png）、測った量を metrics.json に書く。
// 改良案どうしを画像で比べるときは ui-variants.mjs。
import fs from "node:fs";
import path from "node:path";
import { launch, measure, parseView, walk } from "./ui-harness.mjs";

const OUT = path.resolve(process.argv[2] ?? "ui-check");
const VIEWS = (process.argv[3] ?? "1728x1152,1536x864,1280x720").split(",").map(parseView);
const app = await launch();
const report = {};
try {
  fs.mkdirSync(OUT, { recursive: true });
  for (const view of VIEWS) {
    const page = await app.newPage(view);
    await walk(page, async (name) => {
      const id = `${name}-${view.width}`;
      await page.screenshot({ path: path.join(OUT, `${id}.png`) });
      report[id] = await page.evaluate(measure);
      console.log(id, JSON.stringify(report[id]));
    });
    await page.context().close();
  }
} finally {
  await app.close();
}
fs.writeFileSync(path.join(OUT, "metrics.json"), JSON.stringify(report, null, 1));
