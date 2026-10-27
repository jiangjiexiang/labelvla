import { afterEach, describe, expect, it } from 'vitest';
import { isPlaybackShortcutBlocked } from '../../src/react/hooks/shortcutTarget';

function el(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host.firstElementChild as HTMLElement;
}

describe('isPlaybackShortcutBlocked', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('leaves Space and arrows to playback when focus is on the document or a plain row', () => {
    expect(isPlaybackShortcutBlocked(document.body)).toBe(false);
    expect(isPlaybackShortcutBlocked(el('<div tabindex="0">episode 3</div>'))).toBe(false);
  });

  it('leaves Space to a focused button or link but lets the arrows step playback', () => {
    for (const html of [
      '<button>Next frame</button>',
      '<a href="#">Docs</a>',
      '<div role="button" tabindex="0"></div>',
      '<summary>More</summary>',
    ]) {
      const node = el(html);
      expect(isPlaybackShortcutBlocked(node, ' '), html).toBe(true);
      expect(isPlaybackShortcutBlocked(node, 'ArrowRight'), html).toBe(false);
    }
  });

  it('blocks text entry and selects', () => {
    expect(isPlaybackShortcutBlocked(el('<input />'))).toBe(true);
    expect(isPlaybackShortcutBlocked(el('<textarea></textarea>'))).toBe(true);
    expect(isPlaybackShortcutBlocked(el('<select><option>a</option></select>'))).toBe(true);
    expect(isPlaybackShortcutBlocked(el('<div role="combobox"></div>'))).toBe(true);
  });

  it('leaves keys to widgets that own them: tabs, sliders, radios, menus, lists, separators', () => {
    for (const role of ['tab', 'slider', 'radio', 'menuitem', 'option', 'separator', 'checkbox']) {
      expect(isPlaybackShortcutBlocked(el(`<div role="${role}" tabindex="0"></div>`))).toBe(true);
    }
  });

  it('blocks keys inside dialogs', () => {
    const dialog = el('<div role="dialog"><button>OK</button></div>');
    expect(isPlaybackShortcutBlocked(dialog.querySelector('button'))).toBe(true);
  });

  it('accepts elements from another realm (iframe) by node type, not instanceof', () => {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const doc = frame.contentDocument!;
    const row = doc.createElement('div');
    doc.body.appendChild(row);
    const tab = doc.createElement('div');
    tab.setAttribute('role', 'tab');
    doc.body.appendChild(tab);
    expect(isPlaybackShortcutBlocked(row)).toBe(false);
    expect(isPlaybackShortcutBlocked(tab)).toBe(true);
  });
});
