// Geometria do prédio: mapeamento de slots, andares e retângulos. Puro e testável.
//
// The office is one house, CORE_COLS rooms wide. At the top sits the core block, built as a ring:
//
//   [reception][kitchen] atrium [coffee bar][pickleball]     top row (doors onto the north hall)
//   ================== north hall ==========================
//   [restrooms] west  [   CENTRAL OFFICE   ]  east [billiards]
//   [lounge   ] hall  [ doors on all sides ]  hall [karaoke  ]
//   ================== south hall ==========================
//
// Below the ring come the floors of project rooms: an upper row opening onto the hall above, a lower
// row opening onto the hall below, that hall; stair halls down the middle join each hall to the next.
import {
  COL_W,
  CORE_COLS,
  CORE_H,
  CORRIDOR_H,
  CORRIDOR_Y,
  FLOOR_H,
  HALL_W,
  HOUSE_W,
  HUB_W,
  HUB_X,
  houseH,
  ROOM_H,
  ROOMS_PER_FLOOR,
  SOUTH_HALL_Y,
  SOUTH_Y,
  SPINE_COL,
  TILE,
} from '../constants';
import type { TileRect } from './types';

/** 'south' = the room lies south of its hall (door in its north wall); 'north' = north of it (door in its south wall). */
export type Side = 'north' | 'south';

/** Project floor (1 = the first floor under the ring) of a slot. */
export function slotFloor(slot: number): number {
  return 1 + Math.floor(Math.max(0, slot) / ROOMS_PER_FLOOR);
}

/** Room column (0..CORE_COLS-1) of a project slot. */
export function slotColumn(slot: number): number {
  return (Math.max(0, slot) % ROOMS_PER_FLOOR) % CORE_COLS;
}

/** The first CORE_COLS slots of a floor open onto the hall above (they lie south of it), the rest onto the hall below. */
export function slotSide(slot: number): Side {
  return Math.max(0, slot) % ROOMS_PER_FLOOR < CORE_COLS ? 'south' : 'north';
}

/** Top row (tiles) of a project floor. */
export function floorY(floor: number): number {
  return CORE_H + (floor - 1) * FLOOR_H;
}

/** West edge (tiles) of a room column: the columns east of the middle stair hall sit past it. */
export function colX(col: number): number {
  return col * COL_W + (col >= SPINE_COL ? HALL_W : 0);
}

/** West edge (tiles) of the middle stair hall. */
export const SPINE_X = SPINE_COL * COL_W;

/** Retângulo (tiles) de uma sala de projeto num andar/coluna/lado. */
export function cellRect(floor: number, col: number, side: Side): TileRect {
  return { x: colX(col), y: floorY(floor) + (side === 'south' ? 0 : ROOM_H), w: COL_W, h: ROOM_H };
}

export function slotRect(slot: number): TileRect {
  return cellRect(slotFloor(slot), slotColumn(slot), slotSide(slot));
}

/** Slot of a project floor/column/side (inverse of slotFloor/slotColumn/slotSide). */
export function slotAt(floor: number, col: number, side: Side): number {
  return (floor - 1) * ROOMS_PER_FLOOR + (side === 'south' ? 0 : CORE_COLS) + col;
}

/** Floors of project rooms for the slots in use (at least one, so spare rooms fill the house). */
export function floorsFor(slots: Iterable<number>): number {
  let max = -1;
  for (const s of slots) max = Math.max(max, s);
  return max < 0 ? 1 : slotFloor(max);
}

/** The halls that run west to east: the north and south halls of the ring, then one per project floor. */
export function hallRects(floors: number): TileRect[] {
  const out: TileRect[] = [
    { x: 0, y: CORRIDOR_Y, w: HOUSE_W, h: CORRIDOR_H },
    { x: 0, y: SOUTH_HALL_Y, w: HOUSE_W, h: CORRIDOR_H },
  ];
  for (let f = 1; f <= floors; f++) out.push({ x: 0, y: floorY(f) + 2 * ROOM_H, w: HOUSE_W, h: CORRIDOR_H });
  return out;
}

/** The two halls beside the central office, from the north hall to the south hall. */
export function sideHallRects(): TileRect[] {
  return [
    { x: COL_W, y: SOUTH_Y, w: HALL_W, h: 2 * ROOM_H },
    { x: HUB_X + HUB_W, y: SOUTH_Y, w: HALL_W, h: 2 * ROOM_H },
  ];
}

/** The middle stair hall: the atrium in the top row, then one stretch per project floor between its rows. */
export function stairHallRects(floors: number): TileRect[] {
  const out: TileRect[] = [{ x: SPINE_X, y: 0, w: HALL_W, h: CORRIDOR_Y }];
  for (let f = 1; f <= floors; f++) out.push({ x: SPINE_X, y: floorY(f), w: HALL_W, h: 2 * ROOM_H });
  return out;
}

/** The central office. */
export function hubRect(): TileRect {
  return { x: HUB_X, y: SOUTH_Y, w: HUB_W, h: 2 * ROOM_H };
}

export function buildingRect(floors: number): TileRect {
  return { x: 0, y: 0, w: HOUSE_W, h: houseH(floors) };
}

export function rectPx(r: TileRect): { x: number; y: number; w: number; h: number } {
  return { x: r.x * TILE, y: r.y * TILE, w: r.w * TILE, h: r.h * TILE };
}

export function inRect(r: TileRect, tx: number, ty: number): boolean {
  return tx >= r.x && ty >= r.y && tx < r.x + r.w && ty < r.y + r.h;
}
