// Entertainment wing (building columns 2 and 3, between the lounge and the project rooms):
//
//   column 2 north  Coffee Bar       espresso bar, pastry cases, bar stools, cosy armchairs
//   column 2 south  Billiards Club   pool table, cue rack, dartboard, jukebox, high tables
//   column 3 north  Pickleball Court a full court with a net, benches for the crowd, scoreboard
//   column 3 south  Karaoke Stage    stage with a big screen, speakers, dance floor, sofa
//
// The north rooms open onto the corridor through glass (like the kitchen); the south rooms have a
// doorway in their north wall. Group games live in social/: these layouts only place the spots.
import type { WallStyle } from '../../art/api';
import { COL_W, LOWER_Y, NORTH_Y, SOUTH_Y } from '../constants';
import { colX } from './geometry';
import { AreaBuilder, SEATED_SORT_BIAS } from './builder';
import type { AreaLayout } from './types';

export const COFFEEBAR_ID = 'core:cafeteria';
export const BILLIARDS_ID = 'core:sinuca';
export const COURT_ID = 'core:quadra';
export const KARAOKE_ID = 'core:karaoke';

/** First building column of the wing. */
export const FUN_COL = 2;

export const FUN_WALLS = {
  coffeebar: { base: '#b9694c', trim: '#5a3426', pattern: 'brick' } satisfies WallStyle,
  billiards: { base: '#2f5a46', trim: '#c9a45c', pattern: 'wood_panel' } satisfies WallStyle,
  court: { base: '#e8edf2', trim: '#3f7fd8', pattern: 'stripes' } satisfies WallStyle,
  karaoke: { base: '#3a2d5c', trim: '#c25bb0', pattern: 'plain' } satisfies WallStyle,
  glass: { base: '#cfe6f0', trim: '#9fb9c6', pattern: 'glass' } satisfies WallStyle,
};

/** Rows (local) of the karaoke stage: the singers stand on its middle row. */
export const STAGE_ROWS = { y: 2, h: 3 } as const;

export function funAreas(): AreaLayout[] {
  return [layoutCoffeeBar(), layoutBilliards(), layoutCourt(), layoutKaraoke()];
}

export function layoutCoffeeBar(): AreaLayout {
  const b = new AreaBuilder(COFFEEBAR_ID, 'coffeebar', { x: colX(FUN_COL), y: NORTH_Y, w: COL_W, h: 12 });
  const wall = FUN_WALLS.coffeebar;
  b.floor('wood', 0, 0, 16, 12, 601);
  b.area.floorTint = '#8a5a3a';
  b.face(0.5, 15, wall);
  b.cap(0, 0, 0.5, 12, wall);
  b.cap(15.5, 0, 0.5, 12, wall);

  // Back bar against the north wall: pastry case, two espresso machines, the end of the bar.
  b.wall('menu_board', 2.5, undefined, { order: 0.4 });
  for (const lx of [1, 2]) b.furn('bean_sacks', lx, 2, undefined, { order: 0.2 + lx * 0.01 });
  b.furn('pastry_case', 4, 2, undefined, { order: 0.24 });
  for (const lx of [5, 6]) {
    const m = b.furn('espresso_machine', lx, 2, undefined, { order: 0.26 + lx * 0.01 });
    b.spot('coffee', lx, 3, 'up', { dy: -3, furnitureId: m });
  }
  b.furn('bar_counter', 7, 2, 'right', { order: 0.3 });
  b.wall('neon_sign', 11, 'coffee', { order: 0.5 });
  b.furn('plant_small', 10, 2, 'succulent', { order: 0.32 });
  b.furn('plant_tall', 14, 2, 'ficus', { order: 0.21 });

  // Bar island with stools (backs to the camera, facing the barista side).
  b.rug(2.7, 4.6, 4.6, 2.9, '#5a3426', 602);
  (['left', 'mid', 'mid', 'right'] as const).forEach((v, i) => b.furn('bar_counter', 3 + i, 5, v, { order: 0.4 + i * 0.01 }));
  for (let i = 0; i < 4; i++) b.seat('cafe_seat', 'bar_stool', 3 + i, 6, 'up', undefined, { order: 0.45 + i * 0.01 });

  // Cosy corner: two armchairs at a little table, and a bistro table for two below.
  b.rug(9.4, 5.3, 4.2, 5, '#a0522d', 603);
  b.seat('armchair', 'armchair', 10, 6, 'right', 'right', { order: 0.55 });
  b.furn('cafe_table', 11, 6, undefined, { order: 0.54 });
  b.seat('armchair', 'armchair', 12, 6, 'left', 'left', { order: 0.56 });
  b.seat('cafe_seat', 'cafe_chair', 10, 9, 'right', 'right', { order: 0.6 });
  b.furn('cafe_table', 11, 9, undefined, { order: 0.59 });
  b.seat('cafe_seat', 'cafe_chair', 12, 9, 'left', 'left', { order: 0.61 });
  // Window-less west corner: one more table for two.
  b.seat('cafe_seat', 'cafe_chair', 1, 9, 'right', 'right', { order: 0.62 });
  b.furn('cafe_table', 2, 9, undefined, { order: 0.63 });
  b.seat('cafe_seat', 'cafe_chair', 3, 9, 'left', 'left', { order: 0.64 });
  b.furn('floor_lamp', 14, 9, undefined, { order: 0.3 });
  b.furn('plant_tall', 14, 6, 'monstera', { order: 0.22 });

  // Open to the corridor behind glass, with a wide entrance in the middle.
  for (const lx of [1, 2, 3, 4, 5, 10, 11, 12, 13, 14]) b.furn('glass_partition', lx, 11, 'h', { order: 0.15 });
  b.walk(1, 2, 14, 10);
  b.spot('talk', 7, 8, 'right', { group: 'talk:cafeteria', dx: -1 });
  b.spot('talk', 8, 8, 'left', { group: 'talk:cafeteria', dx: 1 });
  const a = b.build();
  a.shade = undefined;
  return a;
}

export function layoutBilliards(): AreaLayout {
  // east of the central office, under the pickleball court: the door opens onto the north hall
  const b = new AreaBuilder(BILLIARDS_ID, 'billiards', { x: colX(FUN_COL + 1), y: SOUTH_Y, w: COL_W, h: 12 });
  const wall = FUN_WALLS.billiards;
  b.floor('carpet', 0, 0, 16, 12, 701, '#6e2b33', '#5d232b');
  b.face(0.5, 15, wall, [{ lx: 7, w: 2 }]);
  b.wall('door_frame', 8, undefined, { order: 0.05 });
  b.south(0.5, 15, 11, { ...wall, exterior: true });
  b.cap(0, 0, 0.5, 12, wall);
  b.cap(15.5, 0, 0.5, 12, wall);
  b.walk(1, 2, 14, 9);
  b.walk(7, 0, 2, 2);
  b.area.door = { x: colX(FUN_COL + 1) + 7, y: SOUTH_Y, w: 2, h: 2 };

  b.wall('neon_sign', 3.75, 'billiards', { order: 0.5 });
  b.wall('cue_rack', 10.5, undefined, { order: 0.4 });
  b.wall('dartboard', 12.5, undefined, { order: 0.45 });
  b.spot('darts', 12, 4, 'up', { dy: -2 });
  b.furn('jukebox', 14, 2, undefined, { order: 0.3 });

  // The pool table (4x2) with a player at each short end, like the ping-pong table.
  b.rug(4.1, 4.2, 5.8, 3.9, '#24473a', 702);
  b.furn('pool_table', 5, 5, undefined, { order: 0.4 });
  const footY = b.py(6) + 4;
  const sortY = b.py(7) + SEATED_SORT_BIAS;
  b.spot('pool', 4, 6, 'right', { x: b.px(5) - 7, y: footY, group: 'pool', sortY });
  b.spot('pool', 9, 6, 'left', { x: b.px(9) + 7, y: footY, group: 'pool', sortY });
  // The crowd watches from behind the table, facing the camera.
  b.spot('watch', 5, 4, 'down', { group: 'watch:sinuca', dx: 3 });
  b.spot('watch', 7, 4, 'down', { group: 'watch:sinuca', dx: 5 });
  b.spot('watch', 8, 8, 'up', { group: 'watch:sinuca', dx: -2 });

  // High table with bar stools, and a pair of armchairs in the west corner.
  b.seat('cafe_seat', 'bar_stool', 11, 8, 'right', undefined, { order: 0.6 });
  b.furn('cafe_table', 12, 8, undefined, { order: 0.59 });
  b.seat('cafe_seat', 'bar_stool', 13, 8, 'left', undefined, { order: 0.61 });
  b.seat('armchair', 'armchair', 1, 8, 'right', 'right', { order: 0.55 });
  b.furn('cafe_table', 2, 8, undefined, { order: 0.54 });
  b.seat('armchair', 'armchair', 3, 8, 'left', 'left', { order: 0.56 });
  b.furn('plant_tall', 1, 5, 'palm', { order: 0.2 });
  b.furn('plant_tall', 14, 10, 'monstera', { order: 0.22 });
  b.furn('floor_lamp', 1, 10, undefined, { order: 0.3 });
  b.spot('talk', 10, 10, 'right', { group: 'talk:sinuca', dx: -1 });
  b.spot('talk', 11, 10, 'left', { group: 'talk:sinuca', dx: 1 });
  const a = b.build();
  a.shade = undefined;
  return a;
}

export function layoutCourt(): AreaLayout {
  const x0 = colX(FUN_COL + 1);
  const b = new AreaBuilder(COURT_ID, 'court', { x: x0, y: NORTH_Y, w: COL_W, h: 12 });
  const wall = FUN_WALLS.court;
  b.floor('wood', 0, 0, 16, 12, 801);
  b.area.floorTint = '#d8b98a';
  // The court: 14x6 tiles with the net on the line between columns 7 and 8.
  b.decal('pickleball_court', 1, 3, 14, 6, 802);
  b.face(0.5, 15, wall);
  b.cap(0, 0, 0.5, 12, wall);
  b.cap(15.5, 0, 0.5, 12, wall);

  b.wall('neon_sign', 4.5, 'pickleball', { order: 0.5 });
  b.wall('scoreboard', 8.5, undefined, { order: 0.45 });
  b.wall('window', 12.75, undefined, { order: 0.4 });
  // Benches along the north wall for the crowd (they face the court and the camera).
  for (const lx of [2, 11]) {
    const bench = b.furn('bench', lx, 2, undefined, { order: 0.3 });
    for (let i = 0; i < 2; i++) b.seat('bench', 'bench', lx + i, 2, 'down', undefined, { noFurniture: true, furnitureId: bench });
  }
  b.furn('ball_cart', 14, 2, undefined, { order: 0.32 });
  b.furn('plant_small', 1, 2, 'fern', { order: 0.2 });
  b.furn('pickleball_net', 7, 3, undefined, { dx: 8, order: 0.4 });
  // A player behind each baseline, facing the net.
  const footY = b.py(6) + 4;
  b.spot('pickleball', 2, 6, 'right', { x: b.px(2), y: footY, group: 'pickleball' });
  b.spot('pickleball', 13, 6, 'left', { x: b.px(14) - 4, y: footY, group: 'pickleball' });
  b.furn('water_cooler', 14, 9, undefined, { order: 0.3 });
  b.spot('water', 14, 10, 'up', { dy: -3 });
  b.furn('plant_small', 1, 9, 'flower', { order: 0.21 });

  for (const lx of [1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14]) b.furn('glass_partition', lx, 11, 'h', { order: 0.15 });
  b.walk(1, 2, 14, 10);
  const a = b.build();
  a.shade = undefined;
  return a;
}

export function layoutKaraoke(): AreaLayout {
  const x0 = colX(FUN_COL + 1);
  // east of the central office, under the billiards club: the door opens onto the south hall
  const b = new AreaBuilder(KARAOKE_ID, 'karaoke', { x: x0, y: LOWER_Y, w: COL_W, h: 12 });
  const wall = FUN_WALLS.karaoke;
  b.floor('carpet', 0, 0, 16, 12, 901, '#2e2446', '#272040');
  b.decal('stage', 4, STAGE_ROWS.y, 11, STAGE_ROWS.h, 902);
  b.decal('dance_floor', 5, 5, 9, 2, 903);
  // The stage takes the whole north wall; the doorway is in the south wall, behind the audience.
  b.face(0.5, 15, wall);
  b.south(0.5, 15, 11, wall, [{ lx: 4, w: 2 }]);
  b.cap(0, 0, 0.5, 12, wall);
  b.cap(15.5, 0, 0.5, 12, wall);
  b.walk(1, 2, 14, 9);
  b.walk(4, 11, 2, 1);
  b.area.door = { x: x0 + 4, y: LOWER_Y + 11, w: 2, h: 1 };

  b.wall('neon_sign', 6, 'karaoke', { order: 0.5 });
  b.wall('karaoke_screen', 11, undefined, { order: 0.45 });
  b.furn('speaker', 4, 4, undefined, { order: 0.35 });
  b.furn('speaker', 14, 4, undefined, { order: 0.36 });
  // Two singers (a duet) on the stage, facing the room.
  b.spot('stage', 9, 3, 'down', { group: 'stage', dx: 2 });
  b.spot('stage', 11, 3, 'down', { group: 'stage', dx: 2 });
  // Crowd: dancing on the dance floor (facing the stage) and seats further back.
  for (const [lx, ly, dx] of [[6, 6, 2], [8, 5, -2], [10, 6, 3], [12, 5, 0]] as const) b.spot('watch', lx, ly, 'up', { group: 'watch:karaoke', dx });
  const sofa = b.furn('sofa', 6, 8, 'up', { order: 0.5 });
  for (let i = 0; i < 3; i++) b.seat('sofa', 'sofa', 6 + i, 8, 'up', 'up', { noFurniture: true, furnitureId: sofa });
  (['blue', 'yellow'] as const).forEach((c, i) => b.seat('beanbag', 'beanbag', 10 + i * 2, 8, 'up', c, { order: 0.6 + i * 0.02 }));
  b.seat('armchair', 'armchair', 3, 8, 'up', 'up', { order: 0.55 });
  b.furn('plant_tall', 1, 10, 'palm', { order: 0.2 });
  b.furn('plant_tall', 14, 10, 'bonsai', { order: 0.21 });
  b.furn('floor_lamp', 1, 6, undefined, { order: 0.3 });
  const a = b.build();
  a.shade = undefined;
  return a;
}
