import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameLoadingFallback } from '@/app/game/GameLoadingFallback';

describe('GameLoadingFallback', () => {
  it('renders an immediate loading shell with a progress bar', () => {
    const html = renderToStaticMarkup(
      createElement(GameLoadingFallback, { status: 'Synchronizing battlefield state' })
    );

    expect(html).toContain('VOIDSTRIKE');
    expect(html).toContain('Synchronizing battlefield state');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('Loading progress');
  });
});
