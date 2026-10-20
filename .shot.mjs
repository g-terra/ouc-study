import { chromium } from "playwright";
const [,, url, out, w="700", h="560"] = process.argv;
const b = await chromium.launch({ executablePath: process.env.PWEXE }); const p = await b.newPage({ viewport: { width: +w, height: +h } });
await p.goto(url); await p.waitForTimeout(800); await p.screenshot({ path: out, fullPage: true }); await b.close();
