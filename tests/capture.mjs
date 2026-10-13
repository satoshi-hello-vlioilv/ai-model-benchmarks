// 画面キャプチャ：UI/UX評価用に全画面のスクリーンショットを撮る
// 使い方: node tests/capture.mjs <出力ディレクトリ> [--hover]
import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = pathToFileURL(path.join(root, "index.html")).href;
const out = process.argv[2] || "shots";
fs.mkdirSync(out, { recursive: true });
const ROUTES = ["overview", "models/matrix", "models/profile", "bench/agentic", "bench/heat", "guide/map", "guide/detail", "future/roadmap", "future/diffusion", "future/capability", "future/safety", "history/timeline", "history/growth", "cost", "speed", "compare", "table", "data"];
const SETS = [["light", 1728, 1152], ["light", 1536, 864], ["dark", 1728, 1152]];
const browser = await chromium.launch();
for (const [theme, w, h] of SETS) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.addInitScript(t => { try { localStorage.clear(); localStorage.setItem("aimb.theme", JSON.stringify(t)); } catch {} }, theme);
  await page.goto(url);
  for (const r of ROUTES) {
    await page.evaluate(x => { location.hash = x; }, r);
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(out, `${theme}-${w}-${r.replace("/", "_")}.png`) });
  }
  if (theme === "light" && w === 1728) {
    // 操作状態：ツールチップとモデル詳細ドロワー
    await page.evaluate(() => { location.hash = "bench/agentic"; }); await page.waitForTimeout(120);
    const bar = await page.$("#view svg g[data-t] path, #view svg g[data-t] rect:not(.row-hover)"); const b = bar && await bar.boundingBox(); if (!b) console.warn("tooltip target not found"); if (b) { await page.mouse.move(b.x + b.width * 0.6, b.y + b.height / 2); await page.waitForTimeout(150); await page.screenshot({ path: path.join(out, `state-tooltip.png`) }); }
    await page.evaluate(() => { location.hash = "overview"; }); await page.waitForTimeout(120);
    await page.click(".kpi .k-m"); await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, `state-drawer.png`) });
  }
  await page.close();
}
await browser.close();
console.log("saved to", out);
