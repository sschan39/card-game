import type { Versioned } from '../version';
import { PROTOCOL_VERSION } from '../version';
import { z } from 'zod';

export const AutoPassRequestSchema = z.object({ protocolVersion: z.literal(PROTOCOL_VERSION),
  roomId: z.string().min(1).max(128), enabled: z.boolean() }).strict();
export const AutoPassStatusSchema = AutoPassRequestSchema.extend({ passAt: z.number().int().nonnegative().nullable(), serverTime: z.number().int().nonnegative() });
export type AutoPassStatus = z.infer<typeof AutoPassStatusSchema>;
import type { PlayerView, ActionOption } from '../views/player-view';
import type { ViewDelta } from '../deltas/view-delta';
import type { SessionInfo } from '../rest/auth';
export interface RoomSetupMessage extends Versioned { deckId?: string }
export interface SnapshotMessage extends Versioned { seq: number; room: PlayerView; testContext?: {scenarioId:string;revision:number;name:string} }
export interface OptionsMessage extends Versioned { roomId: string | null; cardUuid: string | null; zone: 'hand' | 'battlefield' | null; options: ActionOption[] }
export interface RoomMessage extends Versioned { roomId: string }
export const RoomSnapshotRequestSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  roomId: z.string().min(1).max(128),
}).strict();
export interface ErrorMessage extends Versioned { message: string; commandId?: string; action?: string }
export interface ClientActionMessage extends Versioned { roomId: string; actionId: string; commandId?: string; cardUuid?: string; targets?: unknown[]; [field: string]: unknown }
export interface OptionsRequest extends RoomMessage { cardUuid: string; zone: 'hand' | 'battlefield' }
export interface ClientEvents {
  setAutoPass(message: z.infer<typeof AutoPassRequestSchema>): void;
  leaveRoom(message: RoomMessage): void;
  createRoom(message: RoomSetupMessage): void;
  joinRoom(message: RoomMessage & RoomSetupMessage): void;
  requestRoomSnapshot(message: RoomMessage): void;
  playerAction(message: ClientActionMessage): void;
  getOptions(message: OptionsRequest, acknowledge?: (message: OptionsMessage) => void): void;
}
export interface ServerEvents {
  autoPassStatus(message: AutoPassStatus): void;
  sessionReady(message: SessionInfo): void;
  sessionEnded(message: Versioned & { sessionId: string; reason: 'logout' | 'rotated' | 'linked' | 'expired' | 'disabled' }): void;
  roomSnapshot(message: SnapshotMessage): void;
  stateDelta(message: ViewDelta): void;
  optionsForCard(message: OptionsMessage): void;
  roomLeft(message: RoomMessage): void;
  roomCreated(message: RoomMessage): void;
  roomJoined(message: RoomMessage): void;
  roomDestroyed(message: RoomMessage): void;
  rejoined(message: RoomMessage & { playerId: string }): void;
  rejoinFailed(message: Versioned & { reason: string }): void;
  playerJoined(message: Versioned & { playerId: string }): void;
  startGame(message: RoomMessage): void;
  rpsPhase(message: Versioned & { message: string }): void;
  roomFull(message: Versioned): void;
  error(message: ErrorMessage): void;
}
