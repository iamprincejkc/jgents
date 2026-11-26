// Corredores da casa: os dois do anel (norte e sul do escritório central), um por andar de projetos,
// os dois halls ao lado do escritório (ligam o corredor norte ao sul) e o hall de escada no meio,
// que desce de corredor em corredor. Bebedouros, bancos e plantas ficam longe das portas.
import type { WallStyle } from '../../art/api';
import { COL_W, CORE_COLS, CORRIDOR_H, HALL_W } from '../constants';
import { AreaBuilder } from './builder';
import { colX, hallRects, sideHallRects, stairHallRects } from './geometry';
import type { AreaLayout, TileRect } from './types';

export const CORRIDOR_ID = 'core:corredor';
export const STAIR_HALL_ID = 'core:escada';
export const SIDE_HALL_ID = 'core:ala';

const TALL = ['ficus', 'palm', 'monstera', 'bonsai'] as const;
const SMALL = ['fern', 'succulent', 'flower'] as const;
/** Passadeira: uma família de cor só (azul-acinzentado discreto), com leve variação de tom. */
const RUNNERS = ['#8b9bb0', '#8597ab', '#909fb3'] as const;
const HALL_WALL: WallStyle = { base: '#e9e5dc', trim: '#a88e6c', pattern: 'wood_panel' };

/** Id of a west-east hall: 0 = north hall of the ring (the original id), 1 = south hall, 2.. = project floors. */
export function corridorId(i: number): string {
  return i === 0 ? CORRIDOR_ID : `${CORRIDOR_ID}:${i}`;
}

/** Every hall of the house: the west-east halls, the two beside the central office, the stair hall. */
export function layoutHalls(floors: number): AreaLayout[] {
  const out: AreaLayout[] = hallRects(floors).map((r, i) => layoutCorridor(i, r));
  sideHallRects().forEach((r, i) => out.push(layoutSideHall(i, r)));
  stairHallRects(floors).forEach((r, i) => out.push(layoutStairHall(i, r, i === 0 ? 'top' : 'middle')));
  return out;
}

/** Furniture against one side of a hall (lx, kind, variant), chosen to stay clear of that side's doors. */
type Item = readonly [number, 'plant_tall' | 'plant_small' | 'water_cooler' | 'bench', string?];

/**
 * A west-east hall. Glass at both ends (the west end of the north hall is the main entrance). `top`
 * and `bottom` list what stands against its north and south sides.
 */
export function layoutCorridor(i: number, r: TileRect): AreaLayout {
  const w = r.w;
  const b = new AreaBuilder(corridorId(i), 'corridor', r);
  b.floor('concrete', 0, 0, w, CORRIDOR_H, 501 + i);
  for (let ly = 0; ly < CORRIDOR_H; ly++) {
    const v = ly === 0 || ly === CORRIDOR_H - 1 ? 'end' : 'v';
    b.furn('glass_partition', 0, ly, v, { order: 0.1 });
    b.furn('glass_partition', w - 1, ly, v, { order: 0.1 });
  }
  b.walk(1, 0, w - 2, CORRIDOR_H);

  const [top, bottom] = hallItems(i);
  const place = (items: readonly Item[], ly: number) => {
    for (const [lx, kind, v] of items) {
      if (kind === 'water_cooler') {
        b.furn('water_cooler', lx, ly, undefined, { order: 0.5 });
        if (ly === 0) b.spot('water', lx, 1, 'up', { dy: -3 });
      } else if (kind === 'bench') {
        const bench = b.furn('bench', lx, ly, undefined, { order: 0.5 });
        if (ly === 0) for (let k = 0; k < 2; k++) b.seat('bench', 'bench', lx + k, ly, 'down', undefined, { noFurniture: true, furnitureId: bench });
      } else b.furn(kind, lx, ly, v, { order: 0.5 });
    }
  };
  place(top, 0);
  place(bottom, CORRIDOR_H - 1);
  for (let c = 0; c < CORE_COLS; c++) {
    const x = colX(c);
    b.rug(x + 2, 1.95, COL_W - 4, 1.1, RUNNERS[(c + i) % RUNNERS.length], 502 + c + i * 10);
    b.spot('talk', x + 5, 2, 'right', { group: `talk:corredor:${i}:${c}`, dx: -1 });
    b.spot('talk', x + 6, 2, 'left', { group: `talk:corredor:${i}:${c}`, dx: 1 });
  }
  return b.build();
}

/**
 * What stands against each side of hall `i`. Doors to keep clear (x, tiles):
 * - north hall, north side: the glass fronts of the top row (openings at 22-25 kitchen, 32-36 atrium,
 *   43-46 coffee bar, 60-61 court); south side: restrooms 7-8, west hall 16-20, office 33-35,
 *   east hall 48-52, billiards 60-61.
 * - south hall, north side: lounge 7-9, west hall 16-20, office 33-35, east hall 48-52, karaoke 57-58;
 *   south side: the first project floor's doors (column x + 7..8) and the stair hall 32-36.
 * - project halls: room doors at column x + 7..8 on both sides and the stair hall 32-36.
 */
function hallItems(i: number): [Item[], Item[]] {
  if (i === 0)
    return [
      [[2, 'bench'], [13, 'plant_tall', 'palm'], [27, 'water_cooler'], [29, 'plant_small', 'fern'], [49, 'bench'], [66, 'plant_small', 'flower']],
      [[3, 'plant_small', 'flower'], [13, 'plant_tall', 'monstera'], [26, 'plant_small', 'succulent'], [41, 'plant_small', 'fern'], [55, 'plant_tall', 'ficus'], [66, 'plant_small', 'fern']],
    ];
  if (i === 1)
    return [
      [[2, 'plant_small', 'fern'], [13, 'plant_tall', 'ficus'], [26, 'water_cooler'], [40, 'bench'], [54, 'plant_tall', 'palm'], [64, 'plant_small', 'flower']],
      [[3, 'plant_small', 'succulent'], [13, 'plant_tall', 'bonsai'], [28, 'plant_small', 'flower'], [40, 'plant_small', 'fern'], [55, 'plant_tall', 'monstera'], [66, 'plant_small', 'succulent']],
    ];
  // project halls: a water cooler or a bench per column, alternating, plants between the doors
  const top: Item[] = [];
  const bottom: Item[] = [];
  for (let c = 0; c < CORE_COLS; c++) {
    const x = colX(c);
    const k = i + c;
    if (k % 2 === 0) top.push([x + 3, 'water_cooler'], [x + 4, 'plant_small', SMALL[k % SMALL.length]]);
    else top.push([x + 11, 'bench'], [x + 13, 'plant_tall', TALL[k % TALL.length]]);
    bottom.push([x + 12, 'plant_small', SMALL[(k + 1) % SMALL.length]]);
  }
  return [top, bottom];
}

/** A hall beside the central office, from the north hall down to the south hall. */
export function layoutSideHall(i: number, r: TileRect): AreaLayout {
  const b = new AreaBuilder(`${SIDE_HALL_ID}:${i}`, 'corridor', r);
  const H = r.h;
  b.floor('wood', 0, 0, HALL_W, H, 640 + i);
  b.walk(0, 0, HALL_W, H);
  b.rug(1.45, 0.4, 2.1, H - 0.8, '#a0522d', 650 + i);
  // plants against the outer wall (the office door is on the inner side, rows 10-12)
  const outer = i === 0 ? 0 : HALL_W - 1;
  const inner = i === 0 ? HALL_W - 1 : 0;
  b.furn('plant_tall', outer, 2, TALL[i], { order: 0.5 });
  b.furn('plant_small', outer, 9, SMALL[i], { order: 0.5 });
  b.furn('plant_tall', outer, 20, TALL[i + 1], { order: 0.5 });
  b.furn('plant_small', inner, 4, SMALL[i + 1], { order: 0.5 });
  b.furn('plant_small', inner, 18, SMALL[(i + 2) % SMALL.length], { order: 0.5 });
  b.furn('water_cooler', outer, 14, undefined, { order: 0.5 });
  b.spot('water', outer, 15, 'up', { dy: -3 });
  return b.build();
}

/**
 * One piece of the stair hall down the middle of the house: the atrium in the top row (wall with a
 * window) or a stretch joining two halls. The rooms on either side close it with their own walls.
 */
export function layoutStairHall(index: number, r: TileRect, part: 'top' | 'middle'): AreaLayout {
  const b = new AreaBuilder(`${STAIR_HALL_ID}:${index}`, 'corridor', r);
  const H = r.h;
  b.floor('wood', 0, 0, HALL_W, H, 610 + index);
  const top = part === 'top' ? 2 : 0;
  if (part === 'top') {
    b.face(0, HALL_W, HALL_WALL);
    b.wall('window', 2.5, undefined, { order: 0.4 });
  }
  b.walk(0, top, HALL_W, H - top);
  b.rug(1.45, top + 0.2, 2.1, H - top - 0.4, '#a0522d', 620 + index);
  if (part === 'middle') {
    // plants against the walls, a water cooler halfway down, a lane down the middle
    for (const [lx, ly, i] of [[0, 3, 0], [4, 8, 1], [0, 15, 2], [4, 20, 3]] as const) {
      if (ly < H - 1) b.furn(i % 2 ? 'plant_small' : 'plant_tall', lx, ly, i % 2 ? SMALL[(index + i) % SMALL.length] : TALL[(index + i) % TALL.length], { order: 0.5 });
    }
    b.furn('water_cooler', 4, 12, undefined, { order: 0.5 });
    b.spot('water', 4, 13, 'up', { dy: -3 });
  } else {
    // atrium: a bench facing the hall, plants in the corners
    const bench = b.furn('bench', 1, 6, undefined, { order: 0.5 });
    for (let i = 0; i < 2; i++) b.seat('bench', 'bench', 1 + i, 6, 'down', undefined, { noFurniture: true, furnitureId: bench });
    b.furn('plant_tall', 0, 3, TALL[index % TALL.length], { order: 0.5 });
    b.furn('plant_small', 4, 3, SMALL[index % SMALL.length], { order: 0.5 });
  }
  return b.build();
}
