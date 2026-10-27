import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ResizableSidebar } from '../src/react/components/Sidebar/ResizableSidebar';

function render(props: React.ComponentProps<typeof ResizableSidebar> | null = null) {
  return renderToStaticMarkup(
    React.createElement(
      ResizableSidebar,
      { handleLabel: 'Resize episode list', ...props },
      React.createElement('div', null, 'content'),
    ),
  );
}

describe('ResizableSidebar', () => {
  it('renders a constrained splitter hit area to avoid scrollbar overlap', () => {
    const markup = render();

    expect(markup).toContain('absolute inset-y-0 left-0 w-4');
    expect(markup).toMatch(/role="separator"[^>]*class="relative z-10 flex[^"]*\bw-1\b/);
    expect(markup).not.toContain('left-1/2 -translate-x-1/2 w-8 -mx-4');
    // Horizontal: sidebar first, then the handle on its right edge.
    expect(markup.indexOf('lerobot-resizable-sidebar')).toBeLessThan(
      markup.indexOf('role="separator"'),
    );
  });

  it('puts a named, focusable row handle above the sidebar when vertical', () => {
    const markup = render({ orientation: 'vertical' } as React.ComponentProps<
      typeof ResizableSidebar
    >);

    expect(markup).toContain('aria-label="Resize episode list"');
    expect(markup).toContain('aria-orientation="horizontal"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('cursor-row-resize');
    expect(markup).toContain('border-t');
    expect(markup).not.toContain('border-r');
    expect(markup.indexOf('role="separator"')).toBeLessThan(
      markup.indexOf('lerobot-resizable-sidebar'),
    );
  });
});
