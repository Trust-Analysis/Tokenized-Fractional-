#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const distDir = join(projectRoot, "dist");
const budgetFile = join(projectRoot, "bundle-budget.json");
const failOnExceed = process.env.VITE_PERF_BUDGET_FAIL === "true";

const budgets = existsSync(budgetFile)
  ? JSON.parse(readFileSync(budgetFile, "utf8"))
  : { initialJsKb: 250, lazyChunkJsKb: 500, cssKb: 50, maxIncreasePercent: 15 };

const factor = 1 + (budgets.maxIncreasePercent ?? 15) / 100;

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = join(dir, entry.name);
    return entry.isDirectory() ? walk(p) : [p];
  });
}

const files = existsSync(distDir)
  ? walk(distDir).filter((f) => [".js", ".css"].includes(extname(f)))
  : [];

const violations = [];
for (const file of files) {
  const kb = statSync(file).size / 1024;
  const ext = extname(file).toLowerCase();
  const rel = file.slice(projectRoot.length + 1).replace(/\\/g, "/");

  if (ext === ".js") {
    const isInitial = /\/assets\/index[^/]*\.js$/.test(rel) || rel.endsWith("/index.js");
    const limit = (isInitial ? budgets.initialJsKb : budgets.lazyChunkJsKb) * factor;
    if (kb > limit) {
      violations.push(`${rel} is ${kb.toFixed(1)} kB (allowed max: ${limit.toFixed(1)} kB)`);
    }
  }
  if (ext === ".css" && kb > budgets.cssKb * factor) {
    violations.push(`${rel} is ${kb.toFixed(1)} kB (allowed CSS max: ${(budgets.cssKb * factor).toFixed(1)} kB)`);
  }
}

if (violations.length) {
  console.error("Bundle budget violations:");
  for (const v of violations) console.error(" - " + v);
  if (failOnExceed) process.exit(1);
} else {
  console.log("All frontend bundles are within budget.");
}
