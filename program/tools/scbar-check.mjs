// ショートカットの帯の「作る」「今後たずねない」が、本物のマウスで押せて、窓へ問い合わせが届くか・結果が押した所で分かるかを確かめる（評価関数）。
// 自己診断（desktop/src/selftest.js）は element.click() で押すので、ほかの物が上に重なって押せない・押しても届かない、は見逃す。
// 窓の答えは作り物（ui-harness.mjs の FAKE）。作れた・作れなかった（デスクトップへ書けない）の 2 つを確かめる。
//   node program/tools/scbar-check.mjs [出力のフォルダ]
import path from "node:path";
import { FAKE, launch, parseView } from "./ui-harness.mjs";

const out = process.argv[2] || ".";
const DENIED = "C:\\Users\\u\\Desktop\\DefectTrace.lnk: ショートカットを保存できません: アクセスが拒否されました。";
const cases = [
  { name: "作れた", fake: { ...FAKE, shortcut: { made: ["C:\\Users\\u\\Desktop\\DefectTrace.lnk", "C:\\Users\\u\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\DefectTrace.lnk"], problems: [] } },
    ids: ["scMake", "scDecline"] },
  { name: "作れない", fake: { ...FAKE, shortcut: { made: [], problems: [DENIED] } }, ids: ["scMake"] },
];
let bad = 0;
for (const c of cases) {
  const h = await launch(c.fake);
  try {
    for (const v of ["1728x1152", "1280x800"]) {
      for (const id of c.ids) {
        const page = await h.newPage(parseView(v));
        await page.waitForSelector("#scBar:not([hidden])", { timeout: 10000 }).catch(() => {});
        const shown = await page.evaluate(() => !document.getElementById("scBar").hidden);
        const box = await page.locator("#" + id).boundingBox();
        const top = box && await page.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return e ? (e.id || e.className || e.tagName) : null; },
          { x: box.x + box.width / 2, y: box.y + box.height / 2 });
        const sent = [];
        page.on("request", (r) => { if (r.url().includes("/__desktop/shortcut")) sent.push(r.method() + " " + new URL(r.url()).pathname); });
        if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(800);
        const after = await page.evaluate(() => {
          const w = document.getElementById("scWhy");
          return { hidden: document.getElementById("scBar").hidden, why: w && !w.hidden ? w.textContent : "", btn: document.getElementById("scMake").textContent,
            status: document.getElementById("status").textContent };
        });
        await page.screenshot({ path: path.join(out, `scbar-${c.name}-${id}-${v}.png`) });
        const reached = shown && top === id && sent.length === 1;
        const ok = reached && (c.name === "作れた" ? after.hidden : !after.hidden && after.why.includes("アクセスが拒否") && after.btn === "もう一度作る");
        if (!ok) bad++;
        console.log(`${ok ? "OK  " : "NG  "} ${c.name} ${v} ${id}: 帯 ${shown ? "出る" : "出ない"}・押す所の一番上 ${top}・届いた ${JSON.stringify(sent)}・`
          + `押した後 帯 ${after.hidden ? "消えた" : "残る"}・帯の理由「${after.why}」・ボタン「${after.btn}」・知らせ「${after.status}」`);
        await page.context().close();
      }
    }
  } finally {
    await h.close();
  }
}
process.exit(bad ? 1 : 0);
