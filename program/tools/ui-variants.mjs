// 改良案を画像で比べる（見た目を変えるときは、案を必ずこれで画像にして見比べてから選ぶ: CLAUDE.md）。
//
//   node program/tools/ui-variants.mjs 出力フォルダ 案の定義.mjs [--states lot,release] [--views 1728x1152,1536x864,1280x720] [--only A,B]
//
// 案の定義（ES モジュール）は PROPOSALS = [{ key, name, css, ops }] と、任意で STATES = { 状態: "頁の中で動かす文" } を書き出す。
// 今の画面に案ごとの CSS と DOM の組み替え（ops）を当て、ロットを開いた画面で、状態ごと・大きさごとに撮る（状態-幅-案.png）。
// 状態ごとに全案を並べた一覧（sheet-状態-幅.png）も作る。一覧で全体を、1 枚ずつの画像で細部を見て採点する（ui_score.py）。
//
// ops（上から順に当てる）:
//   ["move", 動かすもの, "before"|"after"|"prepend"|"append", 基準]
//   ["class", 対象, クラス名]
//   ["insert", HTML, "beforebegin"|"afterbegin"|"beforeend"|"afterend", 基準]
//   ["attr", 対象, 属性の名前, 値]（値が null なら外す）
//   ["script", "JavaScript の文"]
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { launch, measure, parseView, walk } from "./ui-harness.mjs";

const [outArg, defsArg, ...rest] = process.argv.slice(2);
if (!outArg || !defsArg) {
  console.error("使い方: node program/tools/ui-variants.mjs 出力フォルダ 案の定義.mjs [--states lot,release] [--views 1728x1152,...] [--only A,B]");
  process.exit(2);
}
const option = (name, fallback) => {
  const i = rest.indexOf(`--${name}`);
  return (i >= 0 ? rest[i + 1] : fallback).split(",").filter(Boolean);
};
const OUT = path.resolve(outArg);
const defs = await import(pathToFileURL(path.resolve(defsArg)).href);
const STATE_JS = defs.STATES || { lot: "" };
const STATES = option("states", Object.keys(STATE_JS).join(","));
const VIEWS = option("views", "1728x1152,1536x864,1280x720").map(parseView);
const ONLY = option("only", "");
const TAKE = defs.PROPOSALS.filter((p) => !ONLY.length || ONLY.includes(p.key));

function applyOps(ops) {
  const pick = (s) => { const el = document.querySelector(s); if (!el) throw new Error(`見つからない: ${s}`); return el; };
  const place = (node, where, t) => ({ before: () => t.before(node), after: () => t.after(node), prepend: () => t.prepend(node), append: () => t.append(node) })[where]();
  for (const [kind, a, b, c] of ops) {
    if (kind === "move") place(pick(a), b, pick(c));
    else if (kind === "class") pick(a).className = b;
    else if (kind === "insert") pick(c).insertAdjacentHTML(b, a);
    else if (kind === "attr") (c === null ? pick(a).removeAttribute(b) : pick(a).setAttribute(b, c));
    else if (kind === "script") new Function(a)();
    else throw new Error(`知らない操作: ${kind}`);
  }
}

async function sheet(browser, state, view, metrics) {
  const shot = (key) => `${state}-${view.width}-${key}.png`;
  const shown = defs.PROPOSALS.filter(({ key }) => fs.existsSync(path.join(OUT, shot(key))));
  const cols = Math.min(3, shown.length);
  const tileH = Math.round((600 * view.height) / view.width);
  const tiles = shown.map(({ key, name }) => {
    const m = metrics[`${state}-${view.width}-${key}`] || {};
    return `<figure><figcaption><b>${key}</b> ${name}<small>はみ出し ${m.cut}px・11px 未満 ${m.small}</small></figcaption><img src="${encodeURIComponent(shot(key))}"></figure>`;
  }).join("");
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:20px;background:#e9edf2;font:15px system-ui,sans-serif}
    main{display:grid;grid-template-columns:repeat(${cols},600px);gap:16px}figure{margin:0}figcaption small{display:block;opacity:.7}
    img{width:600px;height:${tileH}px;border:1px solid #c5ced9;border-radius:6px}</style><h1>${state}（${view.width}×${view.height}）</h1><main>${tiles}</main>`;
  const file = path.join(OUT, `sheet-${state}-${view.width}.html`);
  fs.writeFileSync(file, html);
  const page = await browser.newPage({ viewport: { width: cols * 616 + 24, height: 400 } });
  await page.goto(pathToFileURL(file).href);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  // 大きな一覧は 1 度目の撮影に失敗することがある（描き終わる前）。少し待って 1 度だけ撮り直す
  const out = path.join(OUT, `sheet-${state}-${view.width}.png`);
  await page.screenshot({ path: out, fullPage: true }).catch(async () => { await page.waitForTimeout(500); await page.screenshot({ path: out, fullPage: true }); });
  await page.close();
  fs.rmSync(file);
}

const app = await launch();
const saved = path.join(OUT, "metrics.json");
const metrics = fs.existsSync(saved) ? JSON.parse(fs.readFileSync(saved, "utf8")) : {};
try {
  fs.mkdirSync(OUT, { recursive: true });
  for (const view of VIEWS) {
    for (const p of TAKE) {
      const page = await app.newPage(view);
      await walk(page, async () => {}, ["lot"]);
      await page.evaluate(({ css, ops, fn }) => {
        if (css) document.head.append(Object.assign(document.createElement("style"), { textContent: css }));
        new Function("ops", `(${fn})(ops)`)(ops);
      }, { css: p.css || "", ops: p.ops || [], fn: applyOps.toString() });
      for (const state of STATES) {
        await page.evaluate((js) => { document.body.dataset.state = ""; new Function(js)(); }, STATE_JS[state] || "");
        await page.waitForTimeout(200);
        const id = `${state}-${view.width}-${p.key}`;
        await page.screenshot({ path: path.join(OUT, `${id}.png`) });
        metrics[id] = await page.evaluate(measure);
        console.log(id, JSON.stringify(metrics[id]));
      }
      await page.context().close();
    }
    for (const state of STATES) await sheet(app.browser, state, view, metrics);
  }
} finally {
  await app.close();
}
fs.writeFileSync(saved, JSON.stringify(metrics, null, 1));
