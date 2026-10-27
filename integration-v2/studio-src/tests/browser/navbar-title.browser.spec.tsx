import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { Navbar } from '../../src/react/components/Navbar';
import { LoadingProvider } from '../../src/react/contexts/LoadingContext';
import { ThemeProvider } from '../../src/react/contexts/ThemeProvider';
import { I18nProvider } from '@/i18n/core';
import { TooltipProvider } from '@/ui';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LONG_NAME =
  'lerobot_so100_bimanual_pick_and_place_kitchen_counter_with_a_very_long_dataset_name_recorded_2026_v3.zip';

describe('browser: navbar dataset title', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  for (const width of [390, 1280]) {
    it(`never overlaps the controls at ${width}px and keeps the full name as a title`, async () => {
      await page.viewport(width, 800);
      await act(async () => {
        root.render(
          <I18nProvider forcedLanguage="en">
            <ThemeProvider>
              <TooltipProvider>
                <LoadingProvider>
                  <div className="lerobot-root">
                    <Navbar
                      datasetName={LONG_NAME}
                      onGoHome={() => undefined}
                      onOpenDirectory={() => undefined}
                      onExport={() => undefined}
                      onOpenHealth={() => undefined}
                      onToggleSidebar={() => undefined}
                      onTogglePlaybackBar={() => undefined}
                    />
                  </div>
                </LoadingProvider>
              </TooltipProvider>
            </ThemeProvider>
          </I18nProvider>,
        );
      });

      const title = host.querySelector<HTMLElement>('[data-testid="lerobot-navbar-title"]')!;
      expect(title).toBeTruthy();
      expect(title.getAttribute('title')).toBe(LONG_NAME);
      expect(getComputedStyle(title).textOverflow).toBe('ellipsis');
      expect(title.scrollWidth).toBeGreaterThan(title.clientWidth);

      const t = title.getBoundingClientRect();
      const overlapping = [...host.querySelectorAll('nav button, nav a')]
        .map((el) => ({
          label: el.getAttribute('aria-label') ?? el.textContent ?? '',
          r: el.getBoundingClientRect(),
        }))
        .filter(({ r }) => r.width > 0 && r.left < t.right - 0.5 && r.right > t.left + 0.5)
        .map(({ label }) => label);
      expect(overlapping).toEqual([]);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    });
  }
});
