import { describe, expect, it } from 'vitest';
import { FURNITURE, TILE, type FurnitureKind, type RoomTheme } from '../../art/api';
import { COL_W, CORE_COLS, CORE_H, CORRIDOR_H, FLOOR_H, HALL_W, HOUSE_W, houseH, HUB_X, ROOM_H, SOUTH_HALL_Y, SOUTH_Y } from '../constants';
import { AMENITY_KINDS, amenityKind } from './amenity';
import { assembleBuilding, coreAreas } from './building';
import { buildingRect, colX, floorsFor, hallRects, inRect, slotAt, slotColumn, slotFloor, slotRect, slotSide, SPINE_X } from './geometry';
import { corridorId, SIDE_HALL_ID, STAIR_HALL_ID } from './corridor';
import { layoutProjectRoom, roomVariant } from './room';
import { layoutExterior } from './exterior';
import { RECEPTION_ID } from './core';
import { BILLIARDS_ID, COFFEEBAR_ID, COURT_ID, KARAOKE_ID } from './fun';
import { HUB_DOOR, HUB_ID } from './hub';
import type { AreaLayout } from './types';

const theme: RoomTheme = {
  carpet: '#4f6d8f',
  carpet2: '#486685',
  wall: { base: '#e6e2da', trim: '#9a8f80', pattern: 'plain' },
  accent: '#3f7fd8',
  deskVariant: 'wood',
  chairVariant: 'black',
};

function roomsFor(slots: number[]): AreaLayout[] {
  return slots.map((slot) => layoutProjectRoom({ id: `/proj/${slot}`, slot, seed: 1000 + slot * 77 }, theme));
}

/** Blocking furniture never overlaps and every piece stands inside its area. */
function expectFurnitureFits(area: AreaLayout): void {
  const used = new Map<string, string>();
  for (const f of area.furniture) {
    const def = FURNITURE[f.kind];
    expect(def.mount, f.id).toBe('floor');
    for (let y = f.ty; y < f.ty + def.footprint.h; y++) {
      for (let x = f.tx; x < f.tx + def.footprint.w; x++) {
        expect(inRect(area.rect, x, y), `${f.id} fora de ${area.id}`).toBe(true);
        const key = `${x},${y}`;
        if (def.blocks) {
          expect(used.get(key), `${f.id} sobre ${used.get(key)}`).toBeUndefined();
          used.set(key, f.id);
        }
      }
    }
  }
  for (const w of area.wallItems) expect(FURNITURE[w.kind].mount).toBe('wall');
}

describe('mapeamento de slots (casa quadrada que cresce para baixo)', () => {
  it('cada andar de projetos: a fileira de cima de oeste a leste, depois a de baixo', () => {
    expect([0, 1, 2, 3].map(slotColumn)).toEqual([0, 1, 2, 3]);
    // the upper row lies south of the hall above it (door in its north wall), the lower row north of the floor's hall
    expect([0, 3].map(slotSide)).toEqual(['south', 'south']);
    expect([4, 7].map(slotSide)).toEqual(['north', 'north']);
    expect(slotColumn(4)).toBe(0);
    expect([0, 7, 8, 15, 16].map(slotFloor)).toEqual([1, 1, 2, 2, 3]);
    for (const s of [0, 3, 4, 9, 13, 21]) expect(slotAt(slotFloor(s), slotColumn(s), slotSide(s))).toBe(s);
  });

  it('retângulos das salas: abaixo do anel, encostados uns nos outros, sem sobrepor', () => {
    expect(slotRect(0)).toEqual({ x: 0, y: CORE_H, w: COL_W, h: ROOM_H });
    expect(slotRect(1).x).toBe(COL_W);
    expect(slotRect(4)).toEqual({ x: 0, y: CORE_H + ROOM_H, w: COL_W, h: ROOM_H });
    // the first row sits right under the south hall of the ring
    expect(slotRect(0).y).toBe(SOUTH_HALL_Y + CORRIDOR_H);
    // the floor's hall runs under the lower row; the next floor starts under that hall
    expect(slotRect(8).y).toBe(slotRect(4).y + ROOM_H + CORRIDOR_H);
    const seen = new Set<string>();
    for (let s = 0; s < 24; s++) {
      const r = slotRect(s);
      expect(r.x + r.w).toBeLessThanOrEqual(HOUSE_W);
      expect(r.y).toBeGreaterThanOrEqual(CORE_H);
      // no room overlaps the stair hall down the middle
      expect(r.x + r.w <= SPINE_X || r.x >= SPINE_X + HALL_W).toBe(true);
      const k = `${r.x},${r.y}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });

  it('andares: ao menos um andar de projetos sob o anel; largura fixa', () => {
    expect(floorsFor([])).toBe(1);
    expect(floorsFor([0, 7])).toBe(1);
    expect(floorsFor([8])).toBe(2);
    expect(floorsFor([2, 17])).toBe(3);
    expect(buildingRect(3)).toEqual({ x: 0, y: 0, w: HOUSE_W, h: CORE_H + 3 * FLOOR_H });
    expect(houseH(3)).toBe(CORE_H + 3 * FLOOR_H);
    expect(HOUSE_W).toBe(CORE_COLS * COL_W + HALL_W);
  });
});

describe('layout do prédio', () => {
  const slots = [0, 1, 2, 3, 4, 7, 9, 12];
  const rooms = roomsFor(slots);
  const floors = floorsFor(slots);
  const b = assembleBuilding(floors, rooms);
  const reception = coreAreas().find((a) => a.id === RECEPTION_ID)!;
  const elevator = reception.spots.find((s) => s.kind === 'elevator')!;
  const reach = b.grid.reachableFrom(elevator.tx, elevator.ty);
  const reachable = (x: number, y: number) => reach[y * b.grid.w + x] === 1;
  const halls = hallRects(floors);

  it('há dois elevadores com tiles de aproximação caminháveis', () => {
    const elevators = reception.spots.filter((s) => s.kind === 'elevator');
    expect(elevators).toHaveLength(2);
    for (const e of elevators) expect(b.grid.walkable(e.tx, e.ty)).toBe(true);
  });

  it('todos os spots são alcançáveis a partir dos elevadores', () => {
    const unreachable = b.spots.filter((s) => !reachable(s.tx, s.ty)).map((s) => s.id);
    expect(unreachable).toEqual([]);
  });

  it('as portas conectam cada sala (de projeto ou de convivência) a um corredor', () => {
    for (const room of [...rooms, ...b.amenities]) {
      const door = room.door!;
      expect(door, room.id).toBeDefined();
      const side = room.kind === 'amenity' ? slotSide(Number(room.id.split(':')[1])) : room.side;
      for (let x = door.x; x < door.x + door.w; x++) {
        for (let y = door.y; y < door.y + door.h; y++) expect(b.grid.walkable(x, y)).toBe(true);
        // tile do corredor imediatamente fora da porta
        const outside = side === 'north' ? door.y + door.h : door.y - 1;
        expect(halls.some((h) => inRect(h, x, outside)), `${room.id} @${x},${outside}`).toBe(true);
        expect(reachable(x, outside)).toBe(true);
      }
      // o interior inteiro (fora móveis) é alcançável
      const r = room.rect;
      for (let y = r.y + 2; y < r.y + 11; y++)
        for (let x = r.x + 1; x < r.x + 15; x++) if (b.grid.walkable(x, y)) expect(reachable(x, y), `${room.id} @${x},${y}`).toBe(true);
    }
  });

  it('cada sala tem 6 mesas, ao menos 4 lugares extras sentados, interruptor e quadro', () => {
    for (const room of rooms) {
      const desks = room.spots.filter((s) => s.kind === 'desk');
      expect(desks).toHaveLength(6);
      expect(new Set(desks.map((d) => d.rank))).toEqual(new Set([0, 1, 2, 3, 4, 5]));
      expect(desks.filter((d) => d.side === 'N')).toHaveLength(3);
      expect(room.spots.filter((s) => s.kind === 'stool' || s.kind === 'nook').length).toBeGreaterThanOrEqual(4);
      expect(room.spots.filter((s) => s.kind === 'stand').length).toBeGreaterThanOrEqual(3);
      expect(room.spots.filter((s) => s.kind === 'switch')).toHaveLength(1);
      expect(room.wallItems.some((w) => w.kind === 'whiteboard')).toBe(true);
      expect(room.wallItems.some((w) => w.kind === 'sign')).toBe(true);
      expect(room.wallItems.some((w) => w.kind === 'light_switch')).toBe(true);
      for (const d of desks) expect(room.furniture.some((f) => f.id === d.deskId)).toBe(true);
    }
  });

  it('móveis bloqueantes não se sobrepõem e ficam dentro da área', () => {
    for (const area of [...b.core, ...b.halls, ...b.amenities, ...rooms]) expectFurnitureFits(area);
  });

  it('spots têm ids únicos', () => {
    const ids = b.spots.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('pontos de conversa, ping-pong, sinuca, pickleball e o palco vêm em pares', () => {
    const groups = new Map<string, number>();
    const paired = new Set(['talk', 'pingpong', 'pool', 'pickleball', 'stage']);
    for (const s of b.spots) if (s.group && paired.has(s.kind)) groups.set(s.group, (groups.get(s.group) ?? 0) + 1);
    expect([...groups.keys()]).toEqual(expect.arrayContaining(['pool', 'pickleball', 'stage']));
    for (const [, n] of groups) expect(n).toBe(2);
  });

  it('corredores: dois no anel, um por andar, os dois ao lado do escritório e o hall de escada no meio', () => {
    const corridors = b.halls.filter((h) => !h.id.startsWith(STAIR_HALL_ID) && !h.id.startsWith(SIDE_HALL_ID));
    expect(corridors.map((c) => c.id)).toEqual(Array.from({ length: floors + 2 }, (_, i) => corridorId(i)));
    expect(b.halls.filter((h) => h.id.startsWith(SIDE_HALL_ID))).toHaveLength(2);
    const stairs = b.halls.filter((h) => h.id.startsWith(STAIR_HALL_ID));
    expect(stairs).toHaveLength(floors + 1);
    // the stair hall pieces, the west-east halls and the central office cover the middle strip top to bottom
    const hub = b.core.find((a) => a.id === HUB_ID)!;
    let covered = 0;
    for (const h of [...stairs, ...corridors, hub]) if (h.rect.x <= SPINE_X && h.rect.x + h.rect.w >= SPINE_X + HALL_W) covered += h.rect.h;
    expect(covered).toBe(houseH(floors));
    for (const c of [...corridors, ...b.halls.filter((h) => h.id.startsWith(SIDE_HALL_ID))]) {
      // both ends and the middle of every hall are reachable from the elevators
      const r = c.rect;
      const pts = r.w > r.h ? [2, r.w / 2, r.w - 3].map((x) => [r.x + Math.floor(x), r.y + 2]) : [2, r.h / 2, r.h - 3].map((y) => [r.x + 2, r.y + Math.floor(y)]);
      for (const [x, y] of pts) expect(reachable(x, y), `${c.id} @${x},${y}`).toBe(true);
    }
    for (const c of corridors.slice(2)) {
      expect(c.furniture.filter((f) => f.kind === 'water_cooler').length).toBeGreaterThanOrEqual(2);
      expect(c.furniture.filter((f) => f.kind === 'bench').length).toBeGreaterThanOrEqual(2);
      expect(c.furniture.filter((f) => f.kind === 'plant_tall' || f.kind === 'plant_small').length).toBeLessThanOrEqual(CORE_COLS * 3);
    }
  });

  it('a área externa cobre o prédio', () => {
    const ext = layoutExterior(floors);
    expect(ext.bounds.x).toBeLessThan(0);
    expect(ext.bounds.x + ext.bounds.w).toBeGreaterThan(HOUSE_W);
    expect(ext.bounds.y + ext.bounds.h).toBeGreaterThan(houseH(floors));
  });
});

describe('escritório central', () => {
  const b = assembleBuilding(1, []);
  const hub = b.core.find((a) => a.id === HUB_ID)!;
  const reception = b.core.find((a) => a.id === RECEPTION_ID)!;
  const elevator = reception.spots.find((s) => s.kind === 'elevator')!;
  const reach = b.grid.reachableFrom(elevator.tx, elevator.ty);
  const reachable = (x: number, y: number) => reach[y * b.grid.w + x] === 1;
  const areaAt = (x: number, y: number) => [...b.core, ...b.halls].find((a) => inRect(a.rect, x, y))?.id;

  it('fica no meio do anel, entre os dois halls laterais', () => {
    expect(hub.rect).toEqual({ x: HUB_X, y: SOUTH_Y, w: HOUSE_W - 2 * (COL_W + HALL_W), h: 2 * ROOM_H });
    // centred in the house
    expect(hub.rect.x + hub.rect.w / 2).toBe(HOUSE_W / 2);
  });

  it('tem uma porta em cada lado, e cada uma dá num corredor', () => {
    const r = hub.rect;
    const d = HUB_DOOR;
    const doors: { inside: [number, number]; outside: [number, number]; hall: string }[] = [];
    for (let i = 0; i < d.w; i++) {
      doors.push({ inside: [r.x + d.lx + i, r.y], outside: [r.x + d.lx + i, r.y - 1], hall: corridorId(0) });
      doors.push({ inside: [r.x + d.lx + i, r.y + r.h - 1], outside: [r.x + d.lx + i, r.y + r.h], hall: corridorId(1) });
    }
    for (let i = 0; i < d.h; i++) {
      doors.push({ inside: [r.x, r.y + d.ly + i], outside: [r.x - 1, r.y + d.ly + i], hall: `${SIDE_HALL_ID}:0` });
      doors.push({ inside: [r.x + r.w - 1, r.y + d.ly + i], outside: [r.x + r.w, r.y + d.ly + i], hall: `${SIDE_HALL_ID}:1` });
    }
    for (const { inside, outside, hall } of doors) {
      expect(reachable(...inside), `porta @${inside}`).toBe(true);
      expect(reachable(...outside), `fora @${outside}`).toBe(true);
      expect(areaAt(...outside)).toBe(hall);
    }
  });

  it('tem ilha de mesas, mesa de reunião, sofás e mesinhas de café', () => {
    const kinds = hub.furniture.map((f) => f.kind);
    expect(kinds.filter((k) => k === 'desk' || k === 'desk_back')).toHaveLength(6);
    expect(kinds.filter((k) => k === 'meeting_table').length).toBeGreaterThanOrEqual(1);
    expect(kinds.filter((k) => k === 'sofa')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'cafe_table')).toHaveLength(4);
    expect(hub.spots.filter((s) => s.kind === 'cafe_seat').length).toBeGreaterThanOrEqual(12);
    expect(hub.spots.some((s) => s.kind === 'water')).toBe(true);
    expect(hub.spots.some((s) => s.kind === 'snack')).toBe(true);
  });
});

describe('salas de convivência nos lugares sem projeto', () => {
  it('nenhum lugar fica vazio: cada célula tem uma sala de projeto ou de convivência', () => {
    const slots = [0, 5, 9];
    const rooms = roomsFor(slots);
    const floors = floorsFor(slots);
    const b = assembleBuilding(floors, rooms);
    expect(b.amenities).toHaveLength(floors * CORE_COLS * 2 - rooms.length);
    const cells = new Map<string, string>();
    for (const a of [...rooms, ...b.amenities]) {
      const k = `${a.rect.x},${a.rect.y}`;
      expect(cells.get(k), a.id).toBeUndefined();
      cells.set(k, a.id);
    }
    for (let s = 0; s < floors * CORE_COLS * 2; s++) expect(cells.has(`${slotRect(s).x},${slotRect(s).y}`), `slot ${s}`).toBe(true);
    // a project arriving takes the spot over; the amenity comes back when it leaves
    expect(b.amenities.some((a) => a.id === 'amenity:5')).toBe(false);
    expect(assembleBuilding(floors, roomsFor([0, 9])).amenities.some((a) => a.id === 'amenity:5')).toBe(true);
  });

  it('todos os tipos aparecem, com nome, e cada variação é válida', () => {
    const b = assembleBuilding(3, []);
    expect(new Set(b.amenities.map((a) => amenityKind(Number(a.id.split(':')[1]))))).toEqual(new Set(AMENITY_KINDS));
    // a floor never repeats a kind, and floors do not repeat each other's order
    const order = (f: number) => Array.from({ length: CORE_COLS * 2 }, (_, i) => amenityKind((f - 1) * CORE_COLS * 2 + i));
    for (const f of [1, 2, 3]) expect(new Set(order(f)).size, `andar ${f}`).toBe(CORE_COLS * 2);
    expect(order(2)).not.toEqual(order(1));
    const reception = b.core.find((a) => a.id === RECEPTION_ID)!;
    const elevator = reception.spots.find((s) => s.kind === 'elevator')!;
    const reach = b.grid.reachableFrom(elevator.tx, elevator.ty);
    for (const a of b.amenities) {
      expect(a.label, a.id).toBeTruthy();
      expectFurnitureFits(a);
      expect(hiddenWallItems(a), a.id).toEqual([]);
      for (const sp of a.spots) {
        expect(b.grid.walkable(sp.tx, sp.ty), `${sp.id} sobre móvel`).toBe(true);
        expect(reach[sp.ty * b.grid.w + sp.tx], `${sp.id} inalcançável`).toBe(1);
      }
      // the same spot keeps the same room between layouts
      expect(assembleBuilding(3, []).amenities.find((x) => x.id === a.id)).toBe(a);
    }
  });
});

/** Móveis de chão altos que escondem o que está pendurado na parede logo atrás. */
const TALL_FLOOR = new Set<FurnitureKind>(['plant_tall', 'bookshelf', 'binder_shelf', 'fridge', 'vending_machine', 'arcade', 'water_cooler', 'floor_lamp', 'toilet_stall', 'jukebox', 'speaker']);
const WALL_DECOR = new Set<FurnitureKind>([
  'painting', 'poster', 'window', 'tv', 'whiteboard', 'sign', 'clock', 'mirror', 'door_frame',
  'neon_sign', 'menu_board', 'scoreboard', 'karaoke_screen', 'dartboard', 'cue_rack',
]);

/** Itens de parede decorativos com algum móvel alto encostado na frente (ids). */
function hiddenWallItems(area: AreaLayout): string[] {
  const out: string[] = [];
  for (const w of area.wallItems) {
    if (w.on !== 'face' || !WALL_DECOR.has(w.kind)) continue;
    const half = (FURNITURE[w.kind].footprint.w * TILE) / 2 - 2;
    const wy = w.baseY / TILE;
    for (const f of area.furniture) {
      if (!TALL_FLOOR.has(f.kind) || f.ty !== wy) continue;
      const fx0 = f.tx * TILE + (f.dx ?? 0);
      const fx1 = fx0 + FURNITURE[f.kind].footprint.w * TILE;
      if (fx0 < w.cx + half && fx1 > w.cx - half) out.push(`${w.id} atrás de ${f.id}`);
    }
  }
  return out;
}

describe('variações das salas de projeto', () => {
  const seeds = Array.from({ length: 90 }, (_, i) => (i * 7919 + 13) >>> 0);

  it('toda variação é válida: sem sobreposição, tudo alcançável, lugares suficientes', () => {
    for (const slot of [0, 4]) {
      for (const seed of seeds) {
        const room = layoutProjectRoom({ id: `/v/${seed}`, slot, seed }, theme);
        const b = assembleBuilding(floorsFor([slot]), [room]);
        const used = new Map<string, string>();
        for (const f of room.furniture) {
          const def = FURNITURE[f.kind];
          for (let y = f.ty; y < f.ty + def.footprint.h; y++)
            for (let x = f.tx; x < f.tx + def.footprint.w; x++) {
              expect(x >= room.rect.x + 1 && x < room.rect.x + 15 && y >= room.rect.y + 2 && y < room.rect.y + 11, `${f.id} fora do piso`).toBe(true);
              if (!def.blocks) continue;
              expect(used.get(`${x},${y}`), `${f.id} sobre ${used.get(`${x},${y}`)}`).toBeUndefined();
              used.set(`${x},${y}`, f.id);
            }
        }
        const door = room.door!;
        const reach = b.grid.reachableFrom(door.x, door.y);
        for (const sp of room.spots) expect(reach[sp.ty * b.grid.w + sp.tx], `${sp.id} inalcançável (semente ${seed})`).toBe(1);
        const r = room.rect;
        for (let y = r.y + 2; y < r.y + 11; y++)
          for (let x = r.x + 1; x < r.x + 15; x++) if (b.grid.walkable(x, y)) expect(reach[y * b.grid.w + x], `tile ${x},${y} isolado (semente ${seed})`).toBe(1);
        expect(room.spots.filter((sp) => sp.kind === 'desk')).toHaveLength(6);
        expect(room.spots.filter((sp) => sp.kind === 'stool' || sp.kind === 'nook').length).toBeGreaterThanOrEqual(4);
        // spots de uso não podem cair em cima de móvel que bloqueia
        for (const sp of room.spots) expect(b.grid.walkable(sp.tx, sp.ty), `${sp.id} sobre móvel`).toBe(true);
        expect(hiddenWallItems(room)).toEqual([]);
      }
    }
  });

  it('as salas não são todas iguais: espelhamento, canto de reunião e cantos variam', () => {
    const vs = seeds.map(roomVariant);
    expect(new Set(vs.map((v) => v.mirror)).size).toBe(2);
    expect(new Set(vs.map((v) => v.meeting)).size).toBe(3);
    expect(new Set(vs.map((v) => v.left)).size).toBeGreaterThan(1);
    expect(new Set(vs.map((v) => v.right)).size).toBeGreaterThan(1);
    // o piso é porcelanato (azulejo é do banheiro) com um leve tom da sala
    const room = layoutProjectRoom({ id: '/v/x', slot: 0, seed: 42 }, theme);
    expect(room.floors.every((f) => f.kind !== 'tile_white')).toBe(true);
    expect(room.floorTint).toBe(theme.carpet);
  });
});

describe('itens de parede', () => {
  it('quadros, janelas, TV, placas e espelhos não ficam atrás de móveis altos', () => {
    for (const area of [...coreAreas(), ...roomsFor([0, 1, 2, 3, 4, 7])]) expect(hiddenWallItems(area), area.id).toEqual([]);
  });

  it('passagens estreitas nas faces das paredes têm batente', () => {
    const restroom = coreAreas().find((a) => a.kind === 'restroom')!;
    expect(restroom.wallItems.some((w) => w.kind === 'door_frame')).toBe(true);
    expect(coreAreas().find((a) => a.id === BILLIARDS_ID)!.wallItems.some((w) => w.kind === 'door_frame')).toBe(true);
    for (const room of roomsFor([0, 2, 9])) expect(room.wallItems.some((w) => w.kind === 'door_frame'), room.id).toBe(true);
    const amenities = assembleBuilding(1, []).amenities.filter((a) => slotSide(Number(a.id.split(':')[1])) === 'south');
    expect(amenities.length).toBeGreaterThan(0);
    for (const a of amenities) expect(a.wallItems.some((w) => w.kind === 'door_frame'), a.id).toBe(true);
  });
});

describe('ala de lazer', () => {
  const core = coreAreas();
  const area = (id: string) => core.find((a) => a.id === id)!;

  it('fica no núcleo, a leste do hall de escada', () => {
    expect(area(COFFEEBAR_ID).rect.x).toBe(colX(2));
    for (const id of [COURT_ID, BILLIARDS_ID, KARAOKE_ID]) expect(area(id).rect.x, id).toBe(colX(3));
    for (const id of [COFFEEBAR_ID, BILLIARDS_ID, COURT_ID, KARAOKE_ID]) expect(area(id).rect.y + area(id).rect.h, id).toBeLessThanOrEqual(CORE_H);
    // project rooms start below the ring
    expect(slotRect(0).y).toBeGreaterThanOrEqual(area(KARAOKE_ID).rect.y + area(KARAOKE_ID).rect.h);
  });

  it('cada sala tem o que a roda dela precisa', () => {
    const kinds = (id: string) => area(id).spots.map((s) => s.kind);
    expect(kinds(COFFEEBAR_ID).filter((k) => k === 'coffee')).toHaveLength(2);
    expect(area(COFFEEBAR_ID).furniture.filter((f) => f.kind === 'espresso_machine')).toHaveLength(2);
    expect(kinds(BILLIARDS_ID).filter((k) => k === 'pool')).toHaveLength(2);
    expect(kinds(BILLIARDS_ID)).toContain('darts');
    expect(area(BILLIARDS_ID).furniture.some((f) => f.kind === 'pool_table')).toBe(true);
    expect(kinds(COURT_ID).filter((k) => k === 'pickleball')).toHaveLength(2);
    expect(area(COURT_ID).furniture.some((f) => f.kind === 'pickleball_net')).toBe(true);
    expect(area(COURT_ID).decals?.map((d) => d.kind)).toEqual(['pickleball_court']);
    expect(kinds(KARAOKE_ID).filter((k) => k === 'stage')).toHaveLength(2);
    expect(area(KARAOKE_ID).spots.filter((s) => s.group === 'watch:karaoke').length).toBeGreaterThanOrEqual(3);
    expect(area(KARAOKE_ID).wallItems.some((w) => w.kind === 'karaoke_screen')).toBe(true);
  });

  it('os jogadores de pickleball ficam um de cada lado da rede, de frente para ela', () => {
    const net = area(COURT_ID).furniture.find((f) => f.kind === 'pickleball_net')!;
    const netX = (net.tx + FURNITURE.pickleball_net.footprint.w / 2) * TILE + (net.dx ?? 0);
    const [west, east] = area(COURT_ID).spots.filter((s) => s.kind === 'pickleball').sort((p, q) => p.x - q.x);
    expect(west.x).toBeLessThan(netX);
    expect(east.x).toBeGreaterThan(netX);
    expect(west.dir).toBe('right');
    expect(east.dir).toBe('left');
    // a rede fica no meio da quadra desenhada
    const court = area(COURT_ID).decals![0];
    expect(Math.abs(court.x + court.w / 2 - netX)).toBeLessThanOrEqual(1);
  });
});
