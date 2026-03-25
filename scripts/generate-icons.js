#!/usr/bin/env node

/**
 * Generate PNG icons from SVG sources using qlmanage (macOS).
 * Falls back to copying SVGs if qlmanage is unavailable.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, "..");
const iconsDir = resolve(rootDir, "public/icons");

const sizes = [16, 48, 128];

for (const size of sizes) {
  const svgPath = resolve(iconsDir, `icon-${size}.svg`);
  const pngPath = resolve(iconsDir, `icon-${size}.png`);

  if (!existsSync(svgPath)) {
    console.warn(`⚠️  ${svgPath} not found, skipping`);
    continue;
  }

  try {
    // Use qlmanage to convert SVG → PNG on macOS
    execSync(
      `qlmanage -t -s ${size} -o "${iconsDir}" "${svgPath}" 2>/dev/null && mv "${iconsDir}/icon-${size}.svg.png" "${pngPath}"`,
      { stdio: "pipe" },
    );
    console.log(`✅ Generated icon-${size}.png`);
  } catch {
    console.warn(
      `⚠️  Could not convert icon-${size}.svg to PNG (qlmanage failed). Using placeholder.`,
    );
  }
}
