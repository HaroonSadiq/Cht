// Render assets/app-icon.svg to PNG at 1024×1024 (Meta App Icon size).
// Also emits 512 + 256 + 192 + 64 versions for favicons/manifests.
//
// Usage:  node scripts/gen-icon.mjs

import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const svgPath = join(root, 'assets', 'app-icon.svg');
const outDir  = join(root, 'assets');
mkdirSync(outDir, { recursive: true });

const svg = readFileSync(svgPath, 'utf8');
const sizes = [1024, 512, 256, 192, 64];

for (const size of sizes) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
  const out = join(outDir, `app-icon-${size}.png`);
  writeFileSync(out, r.render().asPng());
  console.log(`  ✓ ${out} (${size}×${size})`);
}

// Convenience: copy 1024 → app-icon.png as the main asset
const main = join(outDir, 'app-icon.png');
const r1024 = new Resvg(svg, { fitTo: { mode: 'width', value: 1024 } });
writeFileSync(main, r1024.render().asPng());
console.log(`  ✓ ${main} (default)`);
