import type { GameRoom } from '../../types/game.room.types';
import type { DeltaChange } from '../../types/delta.types';

/**
 * Path-based immutable delta applier.
 *
 * Each DeltaChange carries a dot/bracket path (e.g. "players.player1.life",
 * "battlefield[0].state.isTapped"). We apply changes in causal order,
 * shallow-copying along the path — O(path depth), not O(room size).
 *
 * op semantics mirror the server gameReducer:
 * - 'add'    → set value at path (array element or object key)
 * - 'update' → set value at path
 * - 'remove' → splice array element (path ends in [i]) or delete object key
 */

/** Parse a path into segments: "players.p1.hand[3]" → ["players","p1","hand","3"] */
function parsePath(path: string): string[] {
  return path
    .split(/[.[\]]+/)
    .filter(Boolean);
}

/** Determine if a segment is an array index (all digits). */
function isIndex(segment: string): boolean {
  return /^\d+$/.test(segment);
}

/**
 * Immutably set a value at a path. Returns a new root object.
 */
export function setAtPath(root: GameRoom, path: string, value: unknown): GameRoom {
  const segments = parsePath(path);
  if (segments.length === 0) return root;

  return setAtPathRecursive(root, segments, 0, value) as GameRoom;
}

function setAtPathRecursive(node: any, segments: string[], idx: number, value: unknown): any {
  const seg = segments[idx];

  // Last segment — assign the value
  if (idx === segments.length - 1) {
    if (Array.isArray(node)) {
      const arr = [...node];
      const i = Number(seg);
      arr[i] = value;
      return arr;
    }
    return { ...node, [seg]: value };
  }

  const nextSeg = segments[idx + 1];

  if (Array.isArray(node)) {
    const arr = [...node];
    const i = Number(seg);
    arr[i] = setAtPathRecursive(arr[i], segments, idx + 1, value);
    return arr;
  }

  // Object — recurse into child (array or object)
  const child = node?.[seg];
  const isNextIndex = isIndex(nextSeg);
  const childCopy = setAtPathRecursive(
    child ?? (isNextIndex ? [] : {}),
    segments,
    idx + 1,
    value,
  );
  return { ...node, [seg]: childCopy };
}

/**
 * Immutably remove a value at a path.
 * - Array element (path ends in [i]) → splice index i
 * - Object key (path ends in .key) → delete key
 */
export function removeAtPath(root: GameRoom, path: string): GameRoom {
  const segments = parsePath(path);
  if (segments.length === 0) return root;

  return removeAtPathRecursive(root, segments, 0) as GameRoom;
}

function removeAtPathRecursive(node: any, segments: string[], idx: number): any {
  const seg = segments[idx];

  // Last segment — remove
  if (idx === segments.length - 1) {
    if (Array.isArray(node)) {
      const arr = [...node];
      arr.splice(Number(seg), 1);
      return arr;
    }
    const copy = { ...node };
    delete copy[seg];
    return copy;
  }

  if (Array.isArray(node)) {
    const arr = [...node];
    const i = Number(seg);
    arr[i] = removeAtPathRecursive(arr[i], segments, idx + 1);
    return arr;
  }

  const child = node?.[seg];
  if (child === undefined) return node;
  return { ...node, [seg]: removeAtPathRecursive(child, segments, idx + 1) };
}

/**
 * Apply an ordered list of DeltaChanges to a room snapshot.
 * Returns a new GameRoom.
 */
export function applyDeltaChanges(room: GameRoom, changes: DeltaChange[]): GameRoom {
  let current = room;
  for (const change of changes) {
    if (change.op === 'remove') {
      current = removeAtPath(current, change.path);
    } else {
      current = setAtPath(current, change.path, change.value);
    }
  }
  return current;
}
