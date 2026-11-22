#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const manifestPath = join(REPO_ROOT, "scripts", "toolchain.json");
if (!existsSync(manifestPath)) {
  console.error("Missing scripts/toolchain.json");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (!manifest.tools?.node?.version || !Array.isArray(manifest.envFiles)) {
  console.error("Invalid scripts/toolchain.json structure");
  process.exit(1);
}
const nvmrcPath = join(REPO_ROOT, ".nvmrc");
if (existsSync(nvmrcPath)) {
  const nvmrcVersion = readFileSync(nvmrcPath, "utf8").trim().replace(/^v/, "");
  if (nvmrcVersion && !manifest.tools.node.version.startsWith(nvmrcVersion)) {
    console.error(`Node mismatch: .nvmrc=${nvmrcVersion}, manifest=${manifest.tools.node.version}`);
    process.exit(1);
  }
}
if (process.argv.includes("--check-env")) {
  for (const entry of manifest.envFiles) {
    const src = join(REPO_ROOT, entry.source);
    const dst = join(REPO_ROOT, entry.target);
    if (!existsSync(src) || !existsSync(dst)) {
      console.error(`Missing env file for ${entry.source} -> ${entry.target}`);
      process.exit(1);
    }
    const a = readFileSync(src, "utf8").replace(/\r\n/g, "\n");
    const b = readFileSync(dst, "utf8").replace(/\r\n/g, "\n");
    if (a !== b) {
      console.error(`Env content mismatch between ${entry.source} and ${entry.target}`);
      process.exit(1);
    }
  }
}
console.log("Verified toolchain manifest and setup parity.");
