// Dimensões e ritmos do mundo. Tudo em tiles (TILE px) salvo indicação em contrário.
import { TILE } from '../art/api';

export { TILE };

/** Largura de uma coluna do prédio (uma sala ao norte + uma ao sul). */
export const COL_W = 16;
/** Altura de uma sala: 2 linhas de face da parede norte + 9 de piso + 1 de parede sul. */
export const ROOM_H = 12;
/** Altura do corredor que corta o prédio de leste a oeste. */
export const CORRIDOR_H = 5;
/**
 * Room columns of the house (it never grows sideways). The core block at the top is a ring: a row of
 * rooms, the north hall, the central office with two rooms on each side, the south hall. Project
 * rooms fill the floors below the ring, 8 per floor.
 */
export const CORE_COLS = 4;

/** Rows of the core block (tiles from the top). */
export const NORTH_Y = 0;
/** The north hall, under the top row of rooms. */
export const CORRIDOR_Y = ROOM_H;
/** Upper row beside the central office (restrooms, billiards). */
export const SOUTH_Y = ROOM_H + CORRIDOR_H;
/** Lower row beside the central office (lounge, karaoke). */
export const LOWER_Y = SOUTH_Y + ROOM_H;
/** The south hall, under the central office. */
export const SOUTH_HALL_Y = LOWER_Y + ROOM_H;
/** Height of the core block. */
export const CORE_H = SOUTH_HALL_Y + CORRIDOR_H;
/** One floor of project rooms: a row opening onto the hall above, a row opening onto the hall below, that hall. */
export const FLOOR_H = ROOM_H * 2 + CORRIDOR_H;
/** Project rooms per floor (the upper row west to east, then the lower row). */
export const ROOMS_PER_FLOOR = CORE_COLS * 2;
/** Width of the halls that run north-south (beside the central office, and the stair halls). */
export const HALL_W = 5;
/** Room columns west of the middle stair hall (the rest are east of it). */
export const SPINE_COL = CORE_COLS / 2;
/** Width of the whole house (room columns + the middle stair hall). */
export const HOUSE_W = CORE_COLS * COL_W + HALL_W;
/** The central office: between the side halls, from the north hall to the south hall. */
export const HUB_X = COL_W + HALL_W;
export const HUB_W = HOUSE_W - 2 * (COL_W + HALL_W);

/** Height of the house with `floors` floors of project rooms. */
export function houseH(floors: number): number {
  return CORE_H + floors * FLOOR_H;
}

/** Primeira coluna (local) da porta de 2 tiles das salas. */
export const DOOR_X = 7;
export const DOOR_W = 2;

/** Margens de área externa ao redor do prédio (tiles). */
export const EXT_WEST = 20;
export const EXT_EAST = 20;
export const EXT_NORTH = 16;
export const EXT_SOUTH = 24;

/** Velocidades em px de mundo por segundo. */
export const WALK_SPEED = 3.2 * TILE;
export const RUN_SPEED = 6 * TILE;

/** Deslocamento dos pés dentro do tile em que o personagem está em pé. */
export const FOOT_DX = TILE / 2;
export const FOOT_DY = 11;

/** Zoom permitido (pixels CSS por pixel de mundo). */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 6;

/** Duração das animações de sala (ms). */
export const BUILD_MS = 2600;
export const DISMANTLE_MS = 2200;
export const DISMANTLE_DELAY_MS = 1500;
/** Uma vaga livre antes da última sala espera isto antes de a sala mais distante se mudar para lá. */
export const COMPACT_DELAY_MS = 1200;
/** Debounce para agentes que somem do snapshot. */
export const MISSING_DEBOUNCE_MS = 3000;
