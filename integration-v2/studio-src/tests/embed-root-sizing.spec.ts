import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scopeCssForTests } from '../scripts/vite/cssScopePlugin';

const globalsCss = readFileSync(path.resolve(__dirname, '../src/ui/globals.css'), 'utf8');
const builtCssPath = path.resolve(__dirname, '../dist-lib/lerobot-studio.css');

describe('embedded root sizing contract', () => {
  it('sizes .lerobot-root itself, since scoped utilities only reach descendants', () => {
    const out = scopeCssForTests(`
.lerobot-root { width: 100%; height: 100%; min-height: 0; }
.h-full { height: 100%; }
`);
    // Utilities are scoped to descendants, so `h-full` on the root never matches it...
    expect(out).toContain('.lerobot-root .h-full');
    // ...and the root rule must survive scoping unchanged.
    expect(out).toMatch(/(^|\n)\.lerobot-root\s*\{[^}]*height:\s*100%/);
  });

  it('keeps the root sizing rule in the package stylesheet', () => {
    const rule = /\.lerobot-root\s*\{([^}]*)\}/g;
    const bodies = [...globalsCss.matchAll(rule)].map((m) => m[1]);
    const sizing = bodies.find((body) => /height:\s*100%/.test(body));
    expect(sizing).toBeDefined();
    expect(sizing).toMatch(/width:\s*100%/);
    expect(sizing).toMatch(/min-height:\s*0/);
  });

  // Runs after `npm run build:lib`; skipped on a clean checkout.
  it.skipIf(!existsSync(builtCssPath))(
    'ships the root rule and scoped 640px viewer container queries in dist-lib',
    () => {
      const css = readFileSync(builtCssPath, 'utf8');
      expect(css).toMatch(/\.lerobot-root\s*\{[^}]*height:\s*100%/);
      expect(css).toMatch(
        /\.lerobot-root \.\\@container\\\/viewer\s*\{\s*container:\s*viewer \/ inline-size/,
      );
      expect(css).toMatch(/@container viewer not \(width >= 640px\)\s*\{\s*\.lerobot-root \./);
    },
  );
});
