import { randomBytes, randomUUID } from 'node:crypto';
import { PROTOCOL_VERSION, type PlaytestCommand, type PlaytestEdit, type PlaytestState, type ScenarioRun } from '@card-game/protocol';
import { applyPlaytestEdit, stageablePlaytestAbilities } from '@card-game/engine/engine/playtest-edit';
import { buildScenarioRoom, scenarioRandomState } from '@card-game/engine/engine/scenario-setup';
import { collectCards } from '@card-game/engine/shared/card-query';
import { cardZonePlayer } from '@card-game/engine/shared/card-visibility';
import { getTokenBlueprint, getTokenIds } from '@card-game/engine/library/card-catalog';
import { CardCharacteristicService } from '@card-game/engine/engine/card-characteristic-service';
import type { RoomRuntime } from '../rooms/room-runtime';
import type { SessionRecord } from '../auth/account-store';
import { AuthError } from '../auth/errors';
import { tokenDigest } from '../auth/session';

type Checkpoint = ReturnType<RoomRuntime['testCheckpoint']> & { rng: number };
type Control = 'editor' | 0 | 1;
const historyLimit = 30;
const checkpointLimit = 12;
const tokenCatalog = getTokenIds().map(cardId => ({ cardId, name: getTokenBlueprint(cardId).name }));

export class PlaytestRun {
  readonly random: ReturnType<typeof scenarioRandomState>;
  private readonly undoStack: Checkpoint[] = [];
  private readonly checkpoints = new Map<string, Checkpoint>();
  private history: string[] = [];
  private controls = new Map<string, Control>();
  private editing = false;
  operator?: SessionRecord;
  retainedUntil?: number;

  constructor(readonly run: ScenarioRun, readonly players: [string, string], private readonly runtime: RoomRuntime,
    readonly retained: boolean) {
    this.random = scenarioRandomState(run.snapshot.seed);
  }

  issue(operator: SessionRecord) {
    const credentials = [randomBytes(32), randomBytes(32), randomBytes(32)].map(value => value.toString('base64url'));
    const [editor, seatA, seatB] = credentials;
    this.controls = new Map<string, Control>([[tokenDigest(editor), 'editor'], [tokenDigest(seatA), 0], [tokenDigest(seatB), 1]]);
    this.operator = operator;
    this.retainedUntil = undefined;
    this.runtime.pauseTestRoom(this.run.roomId, this.editing);
    return { protocolVersion: PROTOCOL_VERSION, run: this.run, editor, seats: [seatA, seatB] as [string, string],
      ...(this.retained ? { retained: true as const } : {}) };
  }

  detach(retainedUntil: number): void {
    this.controls.clear();
    this.operator = undefined;
    this.retainedUntil = retainedUntil;
    this.runtime.pauseTestRoom(this.run.roomId, true);
  }

  control(token: string): Control | undefined { return this.controls.get(tokenDigest(token)); }

  startingRoom() {
    return { ...buildScenarioRoom(this.run.roomId, this.players, this.run.snapshot, { uuid: randomUUID, random: this.random.random }), debugMode: 'flow' as const };
  }

  state(revision: number, message = ''): PlaytestState {
    const room = this.runtime.testCheckpoint(this.run.roomId).room;
    const player = (id: string) => ({ id, life: room.players[id].life, mana: room.players[id].mana, landPlaysUsed: room.turnHistory?.landPlays?.[id] ?? 0 });
    const seat = (id: string) => id === this.players[0] ? 0 : 1;
    return { protocolVersion: PROTOCOL_VERSION, roomId: room.roomId, revision, editing: this.editing,
      canUndo: this.undoStack.length > 0, history: this.history, message,
      checkpoints: [...this.checkpoints.keys()], tokens: tokenCatalog,
      stack: room.stack.map(object => ({ uuid: object.uuid, name: object.source.blueprint.name, seat: seat(object.controllerId) })),
      turn: { seat: seat(room.activeTurnPlayerId), priority: room.priorityPlayerId ? seat(room.priorityPlayerId) : null, number: room.turnNumber ?? 1, phase: room.phase },
      players: [player(this.players[0]), player(this.players[1])],
      cards: collectCards(room).map(card => ({ uuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0, zone: card.state.zone,
        name: card.blueprint.name, seat: seat(card.state.zone === 'battlefield' ? card.state.controllerId : cardZonePlayer(card)),
        tapped: card.state.isTapped, summoningSickness: card.state.summoningSickness, damage: card.state.damageTaken, counters: card.state.counters,
        equipment: card.state.zone === 'battlefield' && CardCharacteristicService.resolveSubTypes(room, card).includes('Equipment'),
        activatedAbilities: stageablePlaytestAbilities(room, card).map(ability => ability.id) })) };
  }

  private restore(checkpoint: Checkpoint) {
    this.runtime.restoreTestCheckpoint(checkpoint.room, checkpoint.lastBatchId);
    this.random.restore(checkpoint.rng);
  }

  private remember(message: string): string {
    this.history = [...this.history, message].slice(-historyLimit);
    return message;
  }

  private capture(): Checkpoint { return { ...this.runtime.testCheckpoint(this.run.roomId), rng: this.random.position() }; }

  private pushUndo(checkpoint: Checkpoint): void {
    this.undoStack.push(checkpoint);
    if (this.undoStack.length > historyLimit) this.undoStack.shift();
  }

  edit(edits: readonly PlaytestEdit[]): string {
    if (!this.editing) throw new AuthError(409, 'Open Edit board first.');
    const checkpoint = this.capture();
    let room = checkpoint.room;
    const messages: string[] = [];
    try {
      for (const edit of edits) {
        const changed = applyPlaytestEdit(room, edit, { uuid: randomUUID });
        room = changed.room;
        messages.push(changed.message);
      }
    }
    catch (error) { throw new AuthError(400, error instanceof Error ? error.message : 'The edit could not be applied.'); }
    this.restore({ ...checkpoint, room });
    this.pushUndo(checkpoint);
    for (const message of messages) this.remember(message);
    return messages.length === 1 ? messages[0] : `Applied ${messages.length} board edits.`;
  }

  command(command: PlaytestCommand): string {
    if (command.kind === 'play' || command.kind === 'edit') {
      this.editing = command.kind === 'edit';
      this.runtime.pauseTestRoom(this.run.roomId, this.editing);
      return this.editing ? 'Board editing is open. Play is paused.' : 'Play resumed.';
    }
    if (!this.editing) throw new AuthError(409, 'Open Edit board first.');
    if (command.kind === 'saveCheckpoint' && 'name' in command) {
      if (this.checkpoints.has(command.name)) throw new AuthError(409, 'Choose a new checkpoint name.');
      if (this.checkpoints.size >= checkpointLimit) throw new AuthError(409, 'This run has reached its checkpoint limit.');
      this.checkpoints.set(command.name, this.capture());
      return this.remember(`Saved checkpoint “${command.name}”.`);
    }
    if (command.kind === 'restoreCheckpoint' && 'name' in command) {
      const saved = this.checkpoints.get(command.name);
      if (!saved) throw new AuthError(404, 'That checkpoint is unavailable.');
      const prior = this.capture();
      this.restore(saved);
      this.pushUndo(prior);
      return this.remember(`Restored checkpoint “${command.name}”.`);
    }
    if (command.kind === 'undo') {
      const checkpoint = this.undoStack[this.undoStack.length - 1];
      if (!checkpoint) throw new AuthError(409, 'There is no edit to undo.');
      this.restore(checkpoint);
      this.undoStack.pop();
      return this.remember('Restored the position before the last edit.');
    }
    this.restore({ room: this.startingRoom(), rng: this.run.snapshot.seed, lastBatchId: undefined });
    this.undoStack.length = 0;
    return this.remember('Reset to the starting scenario.');
  }
}
