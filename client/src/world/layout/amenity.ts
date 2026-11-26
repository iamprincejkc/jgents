// Amenity rooms: every spot of the house without a project room is furnished as one of these, so the
// house never shows an empty room. They are real rooms (agents use the shelves, arcades, ping-pong
// tables, sofas and coolers in them) and give way when a project needs the spot. There are as many
// kinds as spots on a floor, so a floor never repeats one. A clear aisle runs down the middle of each
// (columns 6..9), so the door works on either side.
import type { FloorKind, WallStyle } from '../../art/api';
import { tr } from '../../../../shared/i18n';
import { DOOR_W, DOOR_X, ROOMS_PER_FLOOR } from '../constants';
import { AreaBuilder, SEATED_SORT_BIAS } from './builder';
import { slotFloor, slotRect, slotSide } from './geometry';
import type { AreaLayout } from './types';

/** In spot order on a floor: the upper row west to east, then the lower row. */
export const AMENITY_KINDS = ['games', 'library', 'snack', 'garden', 'meeting', 'studio', 'pingpong', 'nap'] as const;
export type AmenityKind = (typeof AMENITY_KINDS)[number];

export const AMENITY_NAME: Readonly<Record<AmenityKind, string>> = {
  library: tr('Biblioteca'),
  meeting: tr('Sala de reunião'),
  games: tr('Sala de jogos'),
  nap: tr('Sala de descanso'),
  garden: tr('Jardim interno'),
  studio: tr('Estúdio de música'),
  pingpong: tr('Sala de pingue-pongue'),
  snack: tr('Lanchonete'),
};

const WALLS: Readonly<Record<AmenityKind, WallStyle>> = {
  library: { base: '#e4d8c4', trim: '#8a6a48', pattern: 'wood_panel' },
  meeting: { base: '#e6e9ee', trim: '#7f93a8', pattern: 'plain' },
  games: { base: '#3b3358', trim: '#7c6ad8', pattern: 'plain' },
  nap: { base: '#e8dfe8', trim: '#a08aa8', pattern: 'plain' },
  garden: { base: '#dfe9da', trim: '#7fa36a', pattern: 'tiles' },
  studio: { base: '#2f2d3a', trim: '#c25bb0', pattern: 'plain' },
  pingpong: { base: '#dfe7ef', trim: '#3f7fd8', pattern: 'plain' },
  snack: { base: '#f1e4cf', trim: '#c8743a', pattern: 'tiles' },
};

const FLOORS: Readonly<Record<AmenityKind, { kind: FloorKind; tint?: string; tint2?: string }>> = {
  library: { kind: 'wood' },
  meeting: { kind: 'marble' },
  games: { kind: 'carpet', tint: '#3a3160', tint2: '#332a55' },
  nap: { kind: 'wood' },
  garden: { kind: 'grass' },
  studio: { kind: 'carpet', tint: '#2e2a3e', tint2: '#282436' },
  pingpong: { kind: 'concrete' },
  snack: { kind: 'tile_white' },
};

/**
 * Which amenity a spot gets: fixed per slot (a spot keeps its room between visits), every kind once per
 * floor, the order shifted from floor to floor so the floors do not look alike.
 */
export function amenityKind(slot: number): AmenityKind {
  const s = Math.max(0, slot);
  return AMENITY_KINDS[(s % ROOMS_PER_FLOOR + 3 * (slotFloor(s) - 1)) % AMENITY_KINDS.length];
}

export function amenityId(slot: number): string {
  return `amenity:${slot}`;
}

export function layoutAmenity(slot: number): AreaLayout {
  const rect = slotRect(slot);
  const side = slotSide(slot);
  const kind = amenityKind(slot);
  const b = new AreaBuilder(amenityId(slot), 'amenity', rect);
  b.area.label = AMENITY_NAME[kind];
  const wall = WALLS[kind];
  const fl = FLOORS[kind];
  b.floor(fl.kind, 0, 0, 16, 12, 1200 + slot, fl.tint, fl.tint2);
  const door = { lx: DOOR_X, w: DOOR_W };
  if (side === 'south') {
    // under its hall: the door is in the north wall
    b.face(0.5, 15, wall, [door]);
    b.wall('door_frame', DOOR_X + DOOR_W / 2, undefined, { order: 0.05 });
    b.south(0.5, 15, 11, wall);
    b.walk(DOOR_X, 0, DOOR_W, 2);
    b.area.door = { x: rect.x + DOOR_X, y: rect.y, w: DOOR_W, h: 2 };
  } else {
    b.face(0.5, 15, wall);
    b.south(0.5, 15, 11, wall, [door]);
    b.walk(DOOR_X, 11, DOOR_W, 1);
    b.area.door = { x: rect.x + DOOR_X, y: rect.y + 11, w: DOOR_W, h: 1 };
  }
  b.cap(0, 0, 0.5, 12, wall);
  b.cap(15.5, 0, 0.5, 12, wall);
  b.walk(1, 2, 14, 9);
  b.rug(DOOR_X - 0.2, side === 'south' ? 2.3 : 8.8, DOOR_W + 0.4, 1.4, '#8b9bb0', 1300 + slot);

  switch (kind) {
    case 'library':
      for (const lx of [1, 3, 11, 13]) {
        b.furn('bookshelf', lx, 2, undefined, { order: 0.3 });
        b.spot('shelf', lx, 3, 'up', { dx: 8, dy: -2 });
      }
      b.furn('binder_shelf', 5, 2, undefined, { order: 0.31 });
      b.furn('binder_shelf', 10, 2, undefined, { order: 0.32 });
      for (const x0 of [1, 10]) {
        b.rug(x0 + 0.3, 5.3, 4.4, 2.4, '#7a4a3a', 1310 + slot + x0);
        b.seat('armchair', 'armchair', x0, 6, 'right', 'right', { order: 0.5 });
        b.furn('coffee_table', x0 + 1, 6, undefined, { order: 0.49 });
        b.seat('armchair', 'armchair', x0 + 3, 6, 'left', 'left', { order: 0.51 });
      }
      b.furn('floor_lamp', 1, 9, undefined, { order: 0.3 });
      b.furn('floor_lamp', 14, 9, undefined, { order: 0.3 });
      b.furn('plant_tall', 5, 9, 'ficus', { order: 0.2 });
      b.furn('plant_small', 10, 9, 'fern', { order: 0.2 });
      if (side === 'north') b.wall('clock', 8, undefined, { order: 0.7 });
      break;
    case 'meeting':
      b.wall('whiteboard', 3.5, undefined, { order: 0.6 });
      b.wall('whiteboard', 12.5, undefined, { order: 0.6 });
      for (const x0 of [2, 11]) {
        b.rug(x0 - 0.6, 3.6, 4.2, 4.8, '#4f6d8f', 1320 + slot + x0);
        b.furn('meeting_table', x0, 5, undefined, { order: 0.5 });
        for (let i = 0; i < 3; i++) {
          b.seat('cafe_seat', 'stool', x0 + i, 4, 'down', undefined, { order: 0.55 + i * 0.01 });
          b.seat('cafe_seat', 'stool', x0 + i, 7, 'up', undefined, { order: 0.6 + i * 0.01 });
        }
      }
      b.furn('plant_tall', 1, 2, 'palm', { order: 0.2 });
      b.furn('plant_tall', 14, 2, 'monstera', { order: 0.2 });
      b.furn('water_cooler', 1, 9, undefined, { order: 0.3 });
      b.spot('water', 1, 10, 'up', { dy: -3 });
      b.furn('plant_small', 14, 10, 'succulent', { order: 0.2 });
      break;
    case 'games':
      for (const lx of [1, 2, 3, 12, 13, 14]) {
        b.furn('arcade', lx, 2, undefined, { order: 0.3 });
        b.spot('arcade', lx, 3, 'up', { dy: -3 });
      }
      b.furn('jukebox', 10, 2, undefined, { order: 0.31 });
      b.wall('poster', 5, 'rocket', { order: 0.5 });
      b.rug(1.4, 5.4, 4.2, 4.2, '#d65454', 1330 + slot);
      b.rug(10.4, 5.4, 4.2, 4.2, '#4f78c8', 1331 + slot);
      (['red', 'yellow', 'blue', 'green'] as const).forEach((c, i) => b.seat('beanbag', 'beanbag', [2, 4, 11, 13][i], 7, 'up', c, { order: 0.6 + i * 0.01 }));
      b.furn('plant_small', 5, 9, 'flower', { order: 0.2 });
      b.furn('plant_small', 10, 9, 'fern', { order: 0.2 });
      break;
    case 'nap':
      b.wall('painting', 3, undefined, { order: 0.6 });
      b.wall('painting', 12.5, undefined, { order: 0.6 });
      b.rug(0.8, 3.6, 5, 6.2, '#c98a9a', 1340 + slot);
      b.rug(10.2, 3.6, 5, 6.2, '#8ab3c9', 1341 + slot);
      for (const x0 of [1, 11]) {
        const sofa = b.furn('sofa', x0, 4, 'down', { order: 0.5 });
        for (let i = 0; i < 3; i++) b.seat('sofa', 'sofa', x0 + i, 4, 'down', undefined, { noFurniture: true, furnitureId: sofa });
      }
      (['blue', 'yellow', 'red', 'green'] as const).forEach((c, i) => b.seat('beanbag', 'beanbag', [1, 4, 11, 14][i], 8, 'down', c, { order: 0.6 + i * 0.01 }));
      b.furn('floor_lamp', 5, 2, undefined, { order: 0.3 });
      b.furn('floor_lamp', 10, 2, undefined, { order: 0.3 });
      b.furn('plant_tall', 5, 10, 'bonsai', { order: 0.2 });
      b.furn('plant_tall', 10, 10, 'palm', { order: 0.2 });
      break;
    case 'garden':
      b.floor('wood', 5.5, 3, 5, 7, 1350 + slot);
      b.wall('window', 3, undefined, { order: 0.4 });
      b.wall('window', 12.75, undefined, { order: 0.4 });
      for (const [lx, ly, v] of [
        [1, 3, 'palm'],
        [3, 3, 'ficus'],
        [12, 3, 'monstera'],
        [14, 3, 'palm'],
        [1, 9, 'monstera'],
        [14, 9, 'ficus'],
      ] as const)
        b.furn('plant_tall', lx, ly, v, { order: 0.2 });
      for (const [lx, ly, v] of [
        [2, 6, 'flower'],
        [13, 6, 'flower'],
        [4, 9, 'fern'],
        [11, 9, 'succulent'],
      ] as const)
        b.furn('plant_small', lx, ly, v, { order: 0.21 });
      for (const x0 of [3, 11]) {
        const bench = b.furn('bench', x0, 7, undefined, { order: 0.5 });
        for (let i = 0; i < 2; i++) b.seat('bench', 'bench', x0 + i, 7, 'down', undefined, { noFurniture: true, furnitureId: bench });
      }
      break;
    case 'studio':
      b.furn('speaker', 1, 2, undefined, { order: 0.3 });
      b.furn('speaker', 14, 2, undefined, { order: 0.3 });
      b.furn('jukebox', 4, 2, undefined, { order: 0.31 });
      // the record collection
      b.furn('binder_shelf', 11, 2, undefined, { order: 0.31 });
      b.furn('binder_shelf', 12, 2, undefined, { order: 0.32 });
      b.wall('poster', 13.5, 'ship_it', { order: 0.5 });
      b.rug(1.4, 4.6, 4.6, 4.2, '#6a4a8a', 1360 + slot);
      b.seat('armchair', 'armchair', 2, 6, 'right', 'right', { order: 0.5 });
      b.furn('coffee_table', 3, 6, undefined, { order: 0.49 });
      b.seat('armchair', 'armchair', 5, 6, 'left', 'left', { order: 0.51 });
      {
        const sofa = b.furn('sofa', 11, 8, 'up', { order: 0.5 });
        for (let i = 0; i < 3; i++) b.seat('sofa', 'sofa', 11 + i, 8, 'up', 'up', { noFurniture: true, furnitureId: sofa });
      }
      b.furn('floor_lamp', 10, 6, undefined, { order: 0.3 });
      b.furn('plant_tall', 14, 10, 'palm', { order: 0.2 });
      b.furn('plant_small', 1, 10, 'fern', { order: 0.2 });
      break;
    case 'pingpong': {
      // two tables either side of the aisle, players at their west and east ends, a bench to watch from
      b.wall('clock', 13.25, undefined, { order: 0.7 });
      b.wall('window', 4.5, undefined, { order: 0.4 });
      b.wall('window', 11, undefined, { order: 0.4 });
      for (const [i, x0] of [[0, 2], [1, 11]] as const) {
        b.rug(x0 - 1.4, 3.6, 5.8, 4.2, i ? '#3f7fd8' : '#2f9e6a', 1370 + slot + i);
        b.furn('pingpong_table', x0, 5, undefined, { order: 0.4 + i * 0.01 });
        const y = b.py(6) + 5;
        const sortY = b.py(7) + SEATED_SORT_BIAS;
        const group = `pingpong:${amenityId(slot)}:${i}`;
        b.spot('pingpong', x0 - 1, 6, 'right', { x: b.px(x0) - 8, y, group, sortY });
        b.spot('pingpong', x0 + 3, 6, 'left', { x: b.px(x0 + 3) + 8, y, group, sortY });
        // the crowd behind the table, facing the camera
        b.spot('watch', x0, 4, 'down', { group: 'watch:pingpong', dx: 2 });
        b.spot('watch', x0 + 2, 4, 'down', { group: 'watch:pingpong', dx: -2 });
      }
      for (const x0 of [2, 12]) {
        const bench = b.furn('bench', x0, 9, undefined, { order: 0.5 });
        for (let k = 0; k < 2; k++) b.seat('bench', 'bench', x0 + k, 9, 'down', undefined, { noFurniture: true, furnitureId: bench });
      }
      b.furn('water_cooler', 14, 9, undefined, { order: 0.3 });
      b.spot('water', 14, 10, 'up', { dy: -3 });
      b.furn('plant_tall', 1, 2, 'palm', { order: 0.2 });
      b.furn('plant_tall', 14, 2, 'ficus', { order: 0.2 });
      b.furn('plant_small', 1, 9, 'fern', { order: 0.21 });
      break;
    }
    case 'snack': {
      // vending machines and a fridge on the north wall, a counter with stools, bistro tables
      b.wall('menu_board', 12, undefined, { order: 0.4 });
      b.wall('clock', 4.5, undefined, { order: 0.7 });
      for (const lx of [1, 2]) {
        const vend = b.furn('vending_machine', lx, 2, undefined, { order: 0.3 + lx * 0.01 });
        b.spot('snack', lx, 3, 'up', { dy: -3, furnitureId: vend });
      }
      b.furn('fridge', 3, 2, undefined, { order: 0.33 });
      b.furn('pastry_case', 11, 2, undefined, { order: 0.34 });
      b.furn('pastry_case', 12, 2, undefined, { order: 0.35 });
      b.furn('plant_tall', 14, 2, 'monstera', { order: 0.2 });
      b.rug(9.7, 4.6, 4.6, 2.9, '#c8743a', 1380 + slot);
      (['left', 'mid', 'mid', 'right'] as const).forEach((v, i) => b.furn('bar_counter', 10 + i, 5, v, { order: 0.4 + i * 0.01 }));
      for (let i = 0; i < 4; i++) b.seat('cafe_seat', 'bar_stool', 10 + i, 6, 'up', undefined, { order: 0.45 + i * 0.01 });
      for (const [i, ly] of [[0, 5], [1, 8]] as const) {
        b.seat('cafe_seat', 'cafe_chair', 1, ly, 'right', 'right', { order: 0.6 + i * 0.03 });
        b.furn('cafe_table', 2, ly, undefined, { order: 0.61 + i * 0.03 });
        b.seat('cafe_seat', 'cafe_chair', 3, ly, 'left', 'left', { order: 0.62 + i * 0.03 });
      }
      b.seat('cafe_seat', 'cafe_chair', 11, 9, 'right', 'right', { order: 0.7 });
      b.furn('cafe_table', 12, 9, undefined, { order: 0.71 });
      b.seat('cafe_seat', 'cafe_chair', 13, 9, 'left', 'left', { order: 0.72 });
      b.furn('water_cooler', 14, 9, undefined, { order: 0.3 });
      b.spot('water', 14, 10, 'up', { dy: -3 });
      b.furn('trash_bin', 4, 2, undefined, { order: 0.36 });
      b.furn('plant_small', 1, 10, 'succulent', { order: 0.2 });
      break;
    }
  }
  const a = b.build();
  a.shade = undefined;
  return a;
}
