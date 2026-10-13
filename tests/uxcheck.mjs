// UI品質の自動検査：見た目の退行を機械的に検出する（UI/UX評価基準 E・D の客観項目）
// 使い方: node tests/uxcheck.mjs [--verbose]
// 検査: ページの縦横はみ出し／文字のはみ出し・省略（…）／SVG文字同士の重なり／強調線が文字を貫く／文字が図形に重なる／番号バッジの重なり／1文字の取り残し改行／10.5px未満の文字／コントラスト不足
import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = pathToFileURL(path.join(root, "index.html")).href;
const verbose = process.argv.includes("--verbose");
const ROUTES = ["overview", "models/matrix", "models/profile", "bench/index", "bench/agentic", "bench/reason", "bench/work", "bench/computer", "bench/heat", "guide/map", "guide/detail", "future/roadmap", "future/diffusion", "future/capability", "future/infra", "future/frontier", "future/safety", "history/timeline", "history/growth", "cost", "speed", "compare", "table", "data"];
const SETS = [["light", 1728, 1152], ["light", 1536, 864], ["dark", 1728, 1152]];

const browser = await chromium.launch();
let total = 0; const byKind = {};
for (const [theme, w, h] of SETS) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.addInitScript(t => { try { localStorage.clear(); localStorage.setItem("aimb.theme", JSON.stringify(t)); } catch {} }, theme);
  await page.goto(url);
  for (const r of ROUTES) {
    await page.evaluate(x => { location.hash = x; }, r);
    await page.waitForTimeout(80);
    const v = await page.evaluate(() => {
      const out = [];
      const add = (kind, msg) => out.push({ kind, msg });
      const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && +cs.opacity !== 0 && !el.closest(".drawer:not(.on), .tip:not(.on), .toast"); };
      if (document.documentElement.scrollHeight > innerHeight + 1 || document.documentElement.scrollWidth > innerWidth + 1) add("page-scroll", "ページがスクロールする");
      // 文字の省略・はみ出し（HTML）
      document.querySelectorAll("body *").forEach(el => {
        if (!vis(el) || el.closest("svg")) return;
        const cs = getComputedStyle(el);
        const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1);
        if (cs.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1) add("ellipsis", `省略: "${el.textContent.trim().slice(0, 30)}"`);
        if (hasText && cs.overflow === "hidden" && cs.textOverflow !== "ellipsis" && el.scrollWidth > el.clientWidth + 2 && !el.matches(".body > div, .chart, .comp")) add("clip", `切れ: "${el.textContent.trim().slice(0, 30)}"`);
        if (cs.webkitLineClamp && cs.webkitLineClamp !== "none" && el.scrollHeight > el.clientHeight + 2) add("ellipsis", `行の省略: "${el.textContent.trim().slice(0, 30)}"`);
        if (hasText && parseFloat(cs.fontSize) < 10.5) add("small", `${cs.fontSize}: "${el.textContent.trim().slice(0, 20)}"`);
      });
      // スクロール領域にあふれ（出典リスト・JSON見本以外）
      document.querySelectorAll("#view *").forEach(el => { const cs = getComputedStyle(el); if ((cs.overflowY === "auto" || cs.overflowY === "hidden") && !el.closest(".src-list, pre") && el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 20 && !el.matches(".chart, svg, .comp, .tip")) { if (!el.matches(".mname span, .li > span, .rec .u")) add("overflow", `あふれ: ${el.className || el.tagName} ${el.scrollHeight}>${el.clientHeight}`); } });
      // SVG：文字の省略・重なり・線の貫通・小さい文字
      document.querySelectorAll("#view svg, .rail svg").forEach(svg => {
        const texts = [...svg.querySelectorAll("text")].filter(vis);
        const rects = texts.map(t => ({ t, r: t.getBoundingClientRect() }));
        texts.forEach(t => { if (t.textContent.trim().endsWith("…")) add("ellipsis", `SVG省略: "${t.textContent.trim()}"`); if (parseFloat(getComputedStyle(t).fontSize) < 10.5 && t.textContent.trim().length > 1) add("small", `SVG ${getComputedStyle(t).fontSize}: "${t.textContent.trim().slice(0, 20)}"`); });
        for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) { const a = rects[i].r, b = rects[j].r; const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); if (ox > 1.5 && oy > 1.5) add("overlap", `重なり: "${rects[i].t.textContent}" × "${rects[j].t.textContent}"`); }
        // 強調線（基準線・今日線・中央値など：破線または太線、格子線 .gl と下線 .ul は除く）が文字の内側を通る（描画順・ハローに関係なく）
        const lineVis = l => { const q = l.getBoundingClientRect(), cs = getComputedStyle(l); return (q.width > 0 || q.height > 0) && cs.display !== "none" && cs.visibility !== "hidden" && +cs.opacity > 0; };
        const lines = [...svg.querySelectorAll("line")].filter(l => lineVis(l) && !l.matches(".gl, .ul") && (getComputedStyle(l).strokeDasharray !== "none" || parseFloat(getComputedStyle(l).strokeWidth) >= 1.5));
        rects.forEach(({ t, r }) => lines.forEach(l => { const q = l.getBoundingClientRect(); const vert = q.width < q.height;
          const cross = vert ? q.left > r.left + 2 && q.left < r.right - 2 && q.top < r.bottom - 3 && q.bottom > r.top + 3 : q.top > r.top + 3 && q.top < r.bottom - 3 && q.left < r.right - 2 && q.right > r.left + 2;
          if (cross) add("line-over-text", `線が文字を貫く: "${t.textContent.trim().slice(0, 24)}"`); }));
        // データの折れ線・曲線（塗りなしの path/polyline）が文字の内側を通る：線上の点を一定間隔で取り、文字の箱（少し内側）に入るかで判定
        const curves = [...svg.querySelectorAll("path, polyline")].filter(e => { const cs = getComputedStyle(e); return cs.fill === "none" && cs.stroke !== "none" && cs.display !== "none" && +cs.opacity > 0 && e.getTotalLength && !e.closest("defs, pattern"); });
        curves.forEach(c => { const L = c.getTotalLength(), M = c.getScreenCTM(); if (!M || !L) return; const pts = []; for (let d = 0; d <= L; d += 3) { const p = c.getPointAtLength(d); pts.push({ x: M.a * p.x + M.c * p.y + M.e, y: M.b * p.x + M.d * p.y + M.f }); }
          rects.forEach(({ t, r }) => { if (pts.some(p => p.x > r.left + 2 && p.x < r.right - 2 && p.y > r.top + 3 && p.y < r.bottom - 3)) add("line-over-text", `線が文字を貫く: "${t.textContent.trim().slice(0, 24)}"`); }); });
        // 文字が図形（帯・棒・点）の上に重なる（同じグループ内の自分のラベル用の図形は除く）
        const shapes = [...svg.querySelectorAll("rect, path, circle")].filter(s => vis(s) && !s.matches(".row-hover, .hit") && (getComputedStyle(s).fill !== "none" || getComputedStyle(s).stroke !== "none") && s.getBoundingClientRect().height < 40 && s.getBoundingClientRect().width < svg.getBoundingClientRect().width * 0.9);
        rects.forEach(({ t, r }) => shapes.forEach(s => { const q = s.getBoundingClientRect(); if (s.closest("defs") || (s.parentNode === t.parentNode && q.width < 16 && q.height < 16)) return; /* 同じグループの小さな点（自分の印）は除く */ if (r.left >= q.left - 1 && r.right <= q.right + 1 && r.top >= q.top - 1 && r.bottom <= q.bottom + 1) return; /* 箱の中に収めたラベル（意図した配置）は除く */ const ox = Math.min(r.right, q.right) - Math.max(r.left, q.left), oy = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top); if (ox > 4 && oy > 4) add("text-over-mark", `文字が図形に重なる: "${t.textContent.trim().slice(0, 24)}"`); }));
      });
      // 位置レーンの番号バッジ同士の重なり（番号が読めなくなる）
      document.querySelectorAll("#view .lane").forEach(l => { const bs = [...l.querySelectorAll(".ld.rk, .ld.grp")].map(e => e.getBoundingClientRect()); for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) { const a = bs[i], c = bs[j]; const ox = Math.min(a.right, c.right) - Math.max(a.left, c.left), oy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top); if (ox > 3 && oy > 3) add("marker-overlap", `番号の重なり: ${l.closest("tr, .rec, .kpi")?.textContent.trim().slice(0, 16) || ""}`); } });
      // 1文字だけが次の行に落ちる改行（単語の途中で折り返して読みにくい）
      document.querySelectorAll("#view *, .subbar *").forEach(el => { if (!vis(el) || el.closest("svg, pre, .tip")) return; [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim().length > 4).forEach(n => { const rg = document.createRange(); rg.selectNodeContents(n); const ls = [...rg.getClientRects()].filter(q => q.width > 0); if (ls.length < 2) return; const last = ls[ls.length - 1], fs = parseFloat(getComputedStyle(el).fontSize); if (last.width < fs * 1.5 && Math.abs(last.top - ls[0].top) > 2) add("orphan", `行末の取り残し: "${n.textContent.trim().slice(0, 20)}"`); }); });
      // コントラスト（主要な文字）
      // oklab()/color() など任意の色表記を、canvas で sRGB に正規化してから輝度を計算
      const cv = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
      const alphaOf = c => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = "rgba(0,0,0,0)"; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); return cv.getImageData(0, 0, 1, 1).data[3] / 255; };
      const rgb = c => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = "#000"; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return `rgb(${d[0]},${d[1]},${d[2]})`; };
      const lum = c0 => { const c = rgb(c0); const m = c.match(/[\d.]+/g); if (!m) return null; const [r, g, b] = m.slice(0, 3).map(x => { x = +x / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const bgOf = el => { for (let e = el; e; e = e.parentElement) { if (e.tagName === "svg" || e.closest?.("svg")) { if (e.tagName !== "svg") continue; } const c = getComputedStyle(e).backgroundColor; if (c.startsWith("oklab") || c.startsWith("color(") || c.startsWith("oklch")) { const al = c.match(/\/\s*([\d.]+)/); if (!al || +al[1] > 0.5) return c; continue; } const a = c.match(/[\d.]+/g); if (a && (a.length < 4 || +a[3] > 0.5)) return c; } return getComputedStyle(document.body).backgroundColor; };
      const seen = new Set();
      document.querySelectorAll("#view *, .top *, .rail *, .subbar *").forEach(el => {
        if (!vis(el)) return;
        const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1); if (!own) return;
        if (el.closest(".dis, [aria-hidden='true']")) return;
        const cs = getComputedStyle(el), isSvg = !!el.closest("svg");
        const fg = isSvg ? cs.fill : cs.color; if (!fg || fg === "none") return;
        const op = (() => { let o = 1; for (let e = el; e && e !== document.body; e = e.parentElement) o *= +getComputedStyle(e).opacity; return o; })();
        // SVG の文字は、真下に描かれた図形（矩形・円など）の塗りを背景とみなす（文字だけでは背景色が分からないため）
        const svgBg = () => { const r = el.getBoundingClientRect(); const under = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2).find(e => e !== el && e.closest("svg") === el.closest("svg") && /^(rect|circle|path|ellipse|polygon)$/.test(e.tagName) && !/^(none|url)/.test(getComputedStyle(e).fill) && alphaOf(getComputedStyle(e).fill) > 0.5 && +getComputedStyle(e).fillOpacity > 0.5 && +getComputedStyle(e).opacity > 0.5); return under ? getComputedStyle(under).fill : null; };
        const L1 = lum(fg), L2 = lum((isSvg && svgBg()) || bgOf(el)); if (L1 == null || L2 == null) return;
        const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05) * (op < 1 ? op : 1);
        const big = parseFloat(cs.fontSize) >= 18 || (parseFloat(cs.fontSize) >= 14 && +cs.fontWeight >= 700);
        if (ratio < (big ? 3 : 4.5)) { const k = el.textContent.trim().slice(0, 16) + "|" + fg; if (!seen.has(k)) { seen.add(k); add("contrast", `${ratio.toFixed(2)}: "${el.textContent.trim().slice(0, 20)}"`); } }
      });
      return out;
    });
    v.forEach(x => { byKind[x.kind] = (byKind[x.kind] || 0) + 1; });
    total += v.length;
    if (v.length && verbose) console.log(`${theme}-${w} #${r}\n  ` + v.map(x => `[${x.kind}] ${x.msg}`).slice(0, 40).join("\n  "));
  }
  await page.close();
}
await browser.close();
console.log(`UX検査: 違反 ${total} 件`, JSON.stringify(byKind));
process.exit(total ? 1 : 0);
