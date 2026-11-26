// The central office ("Main Office"): the heart of the house, ringed by halls, with a doorway on each
// of its four sides. A cross-shaped walkway joins the four doorways; each quarter around it has its
// own corner: an open-plan desk island, a meeting table, a sofa lounge and a bistro corner.
import { TILE, type WallStyle } from '../../art/api';
import { AreaBuilder } from './builder';
import { hubRect } from './geometry';
import type { AreaLayout } from './types';

export const HUB_ID = 'core:escritorio';
/** The group of the CEO's chair at the head of the meeting table (one spot: never a pair for games or chats). */
export const HUB_CEO_GROUP = 'hub:ceo';

const WALL: WallStyle = { base: '#ece7dd', trim: '#a88e6c', pattern: 'wood_panel' };
const GLASS: WallStyle = { base: '#cfe6f0', trim: '#9fb9c6', pattern: 'glass' };

/** Doorways (local tiles): 3 wide in the north and south walls, 3 tall in the west and east walls. */
export const HUB_DOOR = { lx: 12, w: 3, ly: 10, h: 3 } as const;

export function layoutHub(): AreaLayout {
  const r = hubRect();
  const W = r.w;
  const H = r.h;
  const b = new AreaBuilder(HUB_ID, 'office', r);
  const d = HUB_DOOR;
  b.floor('wood', 0, 0, W, H, 1101);
  b.area.floorTint = '#c79a6a';

  // Walls: wood panelling with glass on either side of the north doorway; doorways on all four sides.
  b.face(0.5, 6, WALL);
  b.face(6.5, d.lx - 6.5, GLASS);
  b.face(d.lx + d.w, W - d.lx - d.w - 6.5, GLASS);
  b.face(W - 6.5, 6, WALL);
  b.south(0.5, W - 1, H - 1, WALL, [{ lx: d.lx, w: d.w }]);
  b.cap(0, 0, 0.5, d.ly, WALL);
  b.cap(0, d.ly + d.h, 0.5, H - d.ly - d.h, WALL);
  b.cap(W - 0.5, 0, 0.5, d.ly, WALL);
  b.cap(W - 0.5, d.ly + d.h, 0.5, H - d.ly - d.h, WALL);
  b.walk(1, 2, W - 2, H - 3);
  b.walk(d.lx, 0, d.w, 2);
  b.walk(d.lx, H - 1, d.w, 1);
  b.walk(0, d.ly, 1, d.h);
  b.walk(W - 1, d.ly, 1, d.h);

  // The cross-shaped walkway: a runner each way, planters marking the plaza in the middle.
  b.rug(d.lx + 0.4, 2.2, d.w - 0.8, H - 3.4, '#8a4b2e', 1102);
  b.rug(1.2, d.ly + 0.4, W - 2.4, d.h - 0.8, '#8a4b2e', 1103);
  for (const [lx, ly] of [
    [d.lx - 1, d.ly - 1],
    [d.lx + d.w, d.ly - 1],
    [d.lx - 1, d.ly + d.h],
    [d.lx + d.w, d.ly + d.h],
  ] as const)
    b.furn('plant_small', lx, ly, 'flower', { order: 0.5 });

  // North wall (panelled at both ends, glass either side of the doorway): art, a clock, the team board.
  b.wall('painting', 3.5, undefined, { order: 0.6 });
  b.wall('clock', 5.6, undefined, { order: 0.7 });
  b.wall('whiteboard', 22.5, undefined, { order: 0.6 });

  // North-west: an open-plan desk island (six hot desks face to face) on a rug. The company (the CEO's
  // departments) works here: whoever has a brief takes a free desk (sim.ts, company homes).
  b.rug(1.3, 2.6, 9.4, 6.6, '#3d5a80', 1104);
  for (let i = 0; i < 3; i++) {
    const lx = 2 + i * 3;
    const back = b.furn('desk_back', lx, 4, 'white', { order: 0.42, seat: `hub:n${i}` });
    const front = b.furn('desk', lx, 5, 'white', { order: 0.44, seat: `hub:s${i}` });
    b.seat('desk', 'office_chair_front', lx, 3, 'down', 'black', { dx: TILE / 2, deskId: back, rank: i * 2 + 1, side: 'N', order: 0.4 });
    b.seat('desk', 'office_chair', lx, 6, 'up', 'black', { dx: TILE / 2, deskId: front, rank: i * 2, side: 'S', order: 0.46 });
  }
  b.furn('plant_tall', 10, 8, 'monstera', { order: 0.3 });
  b.furn('filing_cabinet', 1, 8, undefined, { order: 0.3 });
  b.spot('talk', 5, 8, 'right', { group: 'talk:escritorio:1', dx: -1 });
  b.spot('talk', 6, 8, 'left', { group: 'talk:escritorio:1', dx: 1 });

  // North-east: the meeting table under the whiteboard, stools all round.
  b.rug(15.6, 2.6, 9.8, 6.4, '#5c7d5a', 1105);
  b.furn('meeting_table', 17, 4, undefined, { order: 0.5 });
  b.furn('meeting_table', 20, 4, undefined, { order: 0.51 });
  for (let i = 0; i < 6; i++) {
    b.seat('cafe_seat', 'stool', 17 + i, 3, 'down', undefined, { order: 0.55 + i * 0.01 });
    b.seat('cafe_seat', 'stool', 17 + i, 6, 'up', undefined, { order: 0.6 + i * 0.01 });
  }
  // The head of the table: the CEO's chair (group HUB_CEO_GROUP), the CEO's place whether working or not. Half a
  // tile down, to face the middle of the 2-tall tables.
  b.seat('armchair', 'armchair', 16, 4, 'right', 'right', { dy: TILE / 2, group: HUB_CEO_GROUP, order: 0.54 });
  b.furn('plant_tall', 25, 2, 'palm', { order: 0.2 });
  b.furn('plant_tall', 16, 8, 'ficus', { order: 0.21 });
  b.furn('floor_lamp', 25, 8, undefined, { order: 0.3 });

  // South-west: two sofas facing each other over a coffee table.
  b.rug(1.4, 13.6, 9.2, 7.6, '#b86a3c', 1106);
  const north = b.furn('sofa', 3, 14, 'down', { order: 0.5 });
  for (let i = 0; i < 3; i++) b.seat('sofa', 'sofa', 3 + i, 14, 'down', undefined, { noFurniture: true, furnitureId: north });
  b.furn('coffee_table', 3, 17, undefined, { dx: 8, order: 0.52 });
  const south = b.furn('sofa', 3, 19, 'up', { order: 0.54 });
  for (let i = 0; i < 3; i++) b.seat('sofa', 'sofa', 3 + i, 19, 'up', 'up', { noFurniture: true, furnitureId: south });
  b.seat('armchair', 'armchair', 8, 17, 'left', 'left', { order: 0.56 });
  b.furn('floor_lamp', 1, 14, undefined, { order: 0.3 });
  b.furn('plant_tall', 1, 21, 'bonsai', { order: 0.22 });
  b.furn('plant_small', 10, 21, 'fern', { order: 0.23 });

  // South-east: bistro tables, a snack machine and a water cooler.
  b.rug(15.4, 13.6, 9.2, 7.8, '#7a5a8a', 1107);
  for (const [lx, ly, i] of [
    [17, 15, 0],
    [22, 15, 1],
    [17, 19, 2],
    [22, 19, 3],
  ] as const) {
    b.furn('cafe_table', lx, ly, undefined, { order: 0.7 + i * 0.02 });
    b.seat('cafe_seat', 'cafe_chair', lx - 1, ly, 'right', 'right', { order: 0.71 + i * 0.02 });
    b.seat('cafe_seat', 'cafe_chair', lx + 1, ly, 'left', 'left', { order: 0.72 + i * 0.02 });
  }
  const vend = b.furn('vending_machine', 25, 14, undefined, { order: 0.4 });
  b.spot('snack', 25, 15, 'up', { dy: -3, furnitureId: vend });
  b.furn('water_cooler', 25, 18, undefined, { order: 0.41 });
  b.spot('water', 25, 19, 'up', { dy: -3 });
  b.furn('plant_tall', 25, 21, 'monstera', { order: 0.24 });
  b.spot('talk', 19, 12, 'right', { group: 'talk:escritorio:2', dx: -1 });
  b.spot('talk', 20, 12, 'left', { group: 'talk:escritorio:2', dx: 1 });

  const a = b.build();
  a.shade = undefined;
  return a;
}
