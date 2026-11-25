import { createHash } from 'node:crypto';
import { GameEngine } from '@card-game/engine/engine/game-engine';
import { executeBoundMatchCommand } from '@card-game/engine/engine/match-transition';
import { TURN_SEQUENCE } from '@card-game/engine/types/game.state.types';
import type { GameRoom, PlayerId } from '@card-game/engine/types/game.room.types';
import type { AppliedEventBatch } from '@card-game/engine/types/game-event.types';
import type { RuntimeContext } from '@card-game/engine/shared/runtime-context';
import type { ActionPacket } from './action-packet';
import { loadLegacyMatchContent } from '../catalog/match-content';
import { matchRulesFrom } from '../config/gameplay';

const LEGACY_MATCH_FORMAT_VERSION = 1;
export const MATCH_FORMAT_VERSION = 2;
const checkpointInterval = 32;

export interface MatchCheckpoint { room: GameRoom; lastBatchId?: string }
export interface StoredMatch {
  roomId: string;
  version: number;
  checkpoint: string;
  checkpointHash: string;
  checkpointOrdinal: number;
  checkpointSeq: number;
  ordinal: number;
  viewSeq: number;
  stateHash: string;
}

type RecordedInput = ['uuid', string] | ['random', number];

interface CommandEntry {
  inputs: RecordedInput[];
  data: ActionPacket['data'];
  stateHash: string;
  eventHash: string;
  viewSeq: number;
}

export interface StoredMatchCommand {
  ordinal: number;
  playerId: PlayerId;
  commandId: string;
  actionId: string;
  entry: string;
}

export interface MatchRepository {
  matches(): StoredMatch[];
  matchCommands(roomId: string, afterOrdinal: number): StoredMatchCommand[];
  acceptedAction(roomId: string, playerId: PlayerId, commandId: string): string | undefined;
  createMatch(match: StoredMatch): void;
  appendMatchCommand(roomId: string, command: StoredMatchCommand, head: StoredMatch): void;
  deleteMatch(roomId: string): void;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function checkpoint(engine: GameEngine, version = MATCH_FORMAT_VERSION): string {
  const room: GameRoom = version === LEGACY_MATCH_FORMAT_VERSION
    ? { ...engine.roomState, matchContent: undefined }
    : engine.roomState;
  return JSON.stringify({ room, lastBatchId: engine.lastBatchId } satisfies MatchCheckpoint);
}

function eventHash(batches: AppliedEventBatch[]): string {
  return hash(JSON.stringify(batches.map(({ batchId, command, cause, mutations, events }) =>
    ({ batchId, command, cause, mutations, events }))));
}

export class MatchInputs implements RuntimeContext {
  private recording?: RecordedInput[];

  constructor(private readonly runtime: RuntimeContext) {}

  uuid = (): string => {
    const value = this.runtime.uuid();
    this.recording?.push(['uuid', value]);
    return value;
  };

  random = (): number => {
    const value = this.runtime.random();
    this.recording?.push(['random', value]);
    return value;
  };

  record<T>(run: () => T): { result: T; inputs: RecordedInput[] } {
    const inputs: RecordedInput[] = [];
    this.recording = inputs;
    try { return { result: run(), inputs }; }
    finally { this.recording = undefined; }
  }
}

export function openStoredMatch(engine: GameEngine): StoredMatch {
  const state = checkpoint(engine);
  const stateHash = hash(state);
  return {
    roomId: engine.roomState.roomId, version: MATCH_FORMAT_VERSION,
    checkpoint: state, checkpointHash: stateHash, checkpointOrdinal: 0, checkpointSeq: 0,
    ordinal: 0, viewSeq: 0, stateHash,
  };
}

export function recordMatchCommand(
  previous: StoredMatch, engine: GameEngine, packet: ActionPacket, playerId: PlayerId, commandId: string,
  inputs: RecordedInput[], batches: AppliedEventBatch[], publishesDelta: boolean,
): { command: StoredMatchCommand; head: StoredMatch } {
  const ordinal = previous.ordinal + 1;
  const viewSeq = previous.viewSeq + Number(publishesDelta);
  const state = checkpoint(engine);
  const stateHash = hash(state);
  const head = { ...previous, version: MATCH_FORMAT_VERSION, ordinal, viewSeq, stateHash };
  if (previous.version !== MATCH_FORMAT_VERSION || ordinal % checkpointInterval === 0 || engine.roomState.outcome) {
    Object.assign(head, { checkpoint: state, checkpointHash: stateHash, checkpointOrdinal: ordinal, checkpointSeq: viewSeq });
  }
  const entry = JSON.stringify({ inputs, data: packet.data, stateHash, eventHash: eventHash(batches), viewSeq } satisfies CommandEntry);
  return { command: { ordinal, playerId, commandId, actionId: packet.actionId, entry }, head };
}

function readCheckpoint(match: StoredMatch): MatchCheckpoint {
  if (match.version !== MATCH_FORMAT_VERSION && match.version !== LEGACY_MATCH_FORMAT_VERSION) {
    throw new Error('Unsupported match format');
  }
  if (hash(match.checkpoint) !== match.checkpointHash) throw new Error('Match checkpoint checksum failed');
  if (match.checkpointOrdinal < 0 || match.checkpointOrdinal > match.ordinal ||
      match.checkpointSeq < 0 || match.checkpointSeq > match.viewSeq) throw new Error('Invalid match checkpoint position');
  const snapshot = JSON.parse(match.checkpoint) as MatchCheckpoint;
  const room = snapshot.room;
  if (!room || room.roomId !== match.roomId || !room.player2Id || room.player1Id === room.player2Id ||
      !room.players?.[room.player1Id] || !room.players?.[room.player2Id] ||
      !TURN_SEQUENCE.includes(room.phase) || !['playing', 'gameOver'].includes(room.status) ||
      !Array.isArray(room.stack) || !Array.isArray(room.battlefield) || !Array.isArray(room.combat)) {
    throw new Error('Invalid match checkpoint');
  }
  return match.version === LEGACY_MATCH_FORMAT_VERSION
    ? { ...snapshot, room: { ...room, matchContent: loadLegacyMatchContent() } }
    : snapshot;
}

/** Restore an authoritative engine position and independently check the accepted journal tail. */
export function recoverMatch(match: StoredMatch, commands: StoredMatchCommand[]): MatchCheckpoint {
  const saved = readCheckpoint(match);
  let inputs: RecordedInput[] = [];
  let inputIndex = 0;
  const nextInput = <T extends RecordedInput[0]>(kind: T): Extract<RecordedInput, [T, unknown]>[1] => {
    const input = inputs[inputIndex++];
    if (input?.[0] !== kind) throw new Error('Recorded runtime input mismatch');
    return input[1] as Extract<RecordedInput, [T, unknown]>[1];
  };
  const engine = new GameEngine(saved.room, { uuid: () => nextInput('uuid'), random: () => nextInput('random') },
    undefined, saved.lastBatchId);
  engine.initRoom();
  let ordinal = match.checkpointOrdinal;
  let viewSeq = match.checkpointSeq;
  try {
    for (const command of commands) {
      if (command.ordinal !== ++ordinal) throw new Error('Missing match command');
      const entry = JSON.parse(command.entry) as CommandEntry;
      inputs = entry.inputs;
      inputIndex = 0;
      const { result, batches: recordedEvents } = executeBoundMatchCommand(engine, {
        actionId: command.actionId, playerId: command.playerId, data: entry.data, commandId: command.commandId,
      });
      if (!result.success || inputIndex !== inputs.length || hash(checkpoint(engine, match.version)) !== entry.stateHash ||
          eventHash(recordedEvents) !== entry.eventHash) throw new Error('Match command replay diverged');
      viewSeq += Number(Boolean(result.mutations?.length));
      if (viewSeq !== entry.viewSeq) throw new Error('Match view sequence diverged');
    }
    if (ordinal !== match.ordinal || viewSeq !== match.viewSeq || hash(checkpoint(engine, match.version)) !== match.stateHash)
      throw new Error('Match journal head mismatch');
    const room = engine.roomState;
    return { room: match.version === LEGACY_MATCH_FORMAT_VERSION && room.setup
      ? { ...room, setup: matchRulesFrom(room.setup) }
      : room, lastBatchId: engine.lastBatchId };
  } finally { engine.dispose(); }
}
