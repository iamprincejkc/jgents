// Montagem do prédio: núcleo (com o escritório central) + corredores + salas de projeto, e as salas de
// convivência que ocupam os lugares sem projeto -> grade de caminhabilidade e spots.
import { FURNITURE } from '../../art/api';
import { CORE_COLS, HOUSE_W, houseH } from '../constants';
import { BLOCKED, FREE, SEAT, WalkGrid } from '../path/grid';
import { layoutAmenity } from './amenity';
import { furnitureBlocks, furnitureIsSeat } from './builder';
import { layoutCafe, layoutLounge, layoutReception, layoutRestroom } from './core';
import { layoutHalls } from './corridor';
import { funAreas } from './fun';
import { buildingRect, slotAt, slotRect } from './geometry';
import { layoutHub } from './hub';
import type { AreaLayout, SpotDef, TileRect } from './types';

export interface BuildingLayout {
  /** Floors of project rooms under the ring (at least one). */
  floors: number;
  rect: TileRect;
  core: AreaLayout[];
  /** The west-east halls, the two beside the central office, then the stair hall pieces. */
  halls: AreaLayout[];
  rooms: AreaLayout[];
  /** The rooms that fill every project spot without a project (library, games room, ...). */
  amenities: AreaLayout[];
  grid: WalkGrid;
  spots: SpotDef[];
}

let coreCache: AreaLayout[] | null = null;

/** Áreas fixas do núcleo: o escritório central, os cômodos em volta e a ala de lazer (calculadas uma vez). */
export function coreAreas(): AreaLayout[] {
  return (coreCache ??= [layoutHub(), layoutReception(), layoutRestroom(), layoutCafe(), layoutLounge(), ...funAreas()]);
}

const amenityCache = new Map<number, AreaLayout>();

/** The amenity room of a spot (built once per slot, so its layout object stays the same). */
export function amenityAt(slot: number): AreaLayout {
  let a = amenityCache.get(slot);
  if (!a) amenityCache.set(slot, (a = layoutAmenity(slot)));
  return a;
}

/** Amenity rooms for every project spot of `floors` floors that none of `rooms` takes. */
export function amenitiesFor(floors: number, rooms: readonly AreaLayout[]): AreaLayout[] {
  const taken = new Set(rooms.map((r) => `${r.rect.x},${r.rect.y}`));
  const out: AreaLayout[] = [];
  for (let f = 1; f <= floors; f++) {
    for (const side of ['south', 'north'] as const) {
      for (let col = 0; col < CORE_COLS; col++) {
        const slot = slotAt(f, col, side);
        const r = slotRect(slot);
        if (!taken.has(`${r.x},${r.y}`)) out.push(amenityAt(slot));
      }
    }
  }
  return out;
}

/** Marca na grade as células caminháveis de uma área, os bloqueios e os assentos. */
export function paintArea(grid: WalkGrid, area: AreaLayout): void {
  for (const r of area.walkable) grid.fill(r.x, r.y, r.w, r.h, FREE);
  for (const r of area.blocked ?? []) grid.fill(r.x, r.y, r.w, r.h, BLOCKED);
  for (const f of area.furniture) {
    const def = FURNITURE[f.kind];
    if (def.mount !== 'floor') continue;
    const { w, h } = def.footprint;
    if (furnitureBlocks(f.kind)) grid.fill(f.tx, f.ty, w, h, BLOCKED);
    else if (furnitureIsSeat(f.kind)) {
      for (let y = f.ty; y < f.ty + h; y++) for (let x = f.tx; x < f.tx + w; x++) if (grid.get(x, y) === FREE) grid.set(x, y, SEAT);
    }
  }
}

export function buildWalkGrid(floors: number, areas: readonly AreaLayout[], version = 0): WalkGrid {
  const grid = new WalkGrid(HOUSE_W, houseH(floors), version);
  for (const a of areas) paintArea(grid, a);
  return grid;
}

export function assembleBuilding(floors: number, rooms: readonly AreaLayout[], version = 0): BuildingLayout {
  const core = coreAreas();
  const halls = layoutHalls(floors);
  const amenities = amenitiesFor(floors, rooms);
  const all = [...core, ...halls, ...amenities, ...rooms];
  const grid = buildWalkGrid(floors, all, version);
  const spots: SpotDef[] = [];
  for (const a of all) spots.push(...a.spots);
  return { floors, rect: buildingRect(floors), core, halls, rooms: [...rooms], amenities, grid, spots };
}
