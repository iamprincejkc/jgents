// Company faces for the HQ console, drawn by the office's own character art (same seed, look and uniform as the
// characters in the Main Office), as small canvases the CSS scales up with whole pixels.
import type { AgentInfo } from '../../../shared/types';
import { appearanceFromSeed } from '../art/character/appearance';
import { renderCharacter } from '../art/character/render';

const cache = new Map<string, HTMLCanvasElement>();

function key(m: Pick<AgentInfo, 'seed' | 'look' | 'parts'>): string {
  return `${m.seed}|${m.look}|${JSON.stringify(m.parts ?? {})}`;
}

/** The character standing, facing you (a copy: the same face can be in several places on the page). */
export function portrait(m: Pick<AgentInfo, 'seed' | 'look' | 'parts'>, label = ''): HTMLCanvasElement {
  const k = key(m);
  let src = cache.get(k);
  if (!src) {
    src = document.createElement('canvas');
    try {
      const appearance = appearanceFromSeed(m.seed, { look: m.look, parts: m.parts });
      const { buf } = renderCharacter({ appearance, dir: 'down', pose: 'stand', frame: 0 });
      src.width = Math.max(1, buf.w);
      src.height = Math.max(1, buf.h);
      if (buf.w > 0 && buf.h > 0) src.getContext('2d')?.putImageData(new ImageData(buf.data, buf.w, buf.h), 0, 0);
    } catch {
      // art trouble: an empty frame keeps the layout
    }
    cache.set(k, src);
  }
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d')?.drawImage(src, 0, 0);
  c.className = 'portrait';
  if (label) {
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', label);
  } else c.setAttribute('aria-hidden', 'true');
  return c;
}
