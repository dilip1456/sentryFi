#!/usr/bin/env node
/**
 * build:icons — copies brand assets from /assets to /public
 * and regenerates all Android mipmap icon sizes.
 *
 * Usage: npm run build:icons
 * Run after replacing any file in /assets/
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, cpSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, "..");

// Copy web assets
const copies = [
  ["assets/logo.png",              "public/logo.png"],
  ["assets/og-image.png",          "public/og-image.png"],
  ["assets/apple-touch-icon.png",  "public/apple-touch-icon.png"],
];

for (const [src, dst] of copies) {
  const s = join(root, src);
  const d = join(root, dst);
  if (existsSync(s)) {
    cpSync(s, d);
    console.log(`✓ ${src} → ${dst}`);
  } else {
    console.warn(`⚠ Missing: ${src}`);
  }
}

// Regenerate Android icons using Python (PIL)
const py = `
from PIL import Image
import os, shutil

root = r"${root.replace(/\\/g, "/")}";

master = Image.open(f"{root}/assets/logo.png").convert("RGBA")
fg = Image.open(f"{root}/assets/icon-foreground.png").convert("RGBA")

sizes = {"ldpi":36,"mdpi":48,"hdpi":72,"xhdpi":96,"xxhdpi":144,"xxxhdpi":192}
adaptive = {"mdpi":108,"hdpi":162,"xhdpi":216,"xxhdpi":324,"xxxhdpi":432}

for density, px in sizes.items():
    d = f"{root}/android/app/src/main/res/mipmap-{density}"
    if os.path.isdir(d):
        r = master.resize((px,px), Image.LANCZOS)
        r.save(f"{d}/ic_launcher.png")
        r.save(f"{d}/ic_launcher_round.png")

for density, px in adaptive.items():
    d = f"{root}/android/app/src/main/res/mipmap-{density}"
    if os.path.isdir(d):
        canvas = Image.new("RGBA",(px,px),(0,0,0,0))
        scaled = fg.resize((int(px*0.75),int(px*0.75)),Image.LANCZOS)
        off=(px-int(px*0.75))//2
        canvas.paste(scaled,(off,off),scaled)
        canvas.save(f"{d}/ic_launcher_foreground.png")

print("Android icons regenerated")
`;

try {
  execSync(`python3 -c '${py.replace(/'/g, "'\"'\"'")}'`, { stdio: "inherit" });
} catch {
  console.warn("⚠ Python/PIL not available — Android icons not regenerated");
}

// Favicon
console.log("\nFavicon: drop assets/favicon-source.png into https://realfavicongenerator.net");
console.log("Download the package and replace public/favicon.ico\n");
console.log("Done. Commit and push to deploy.");
