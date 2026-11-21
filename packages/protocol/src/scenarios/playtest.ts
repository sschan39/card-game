import { z } from 'zod';
import { CardIdSchema } from '../decks/deck';
import { SessionTokenSchema } from '../rest/auth';
import { ScenarioRunSchema, ScenarioSchema } from './scenario';

const version = z.literal(1);
const uuid = z.string().uuid();
const seat = z.union([z.literal(0), z.literal(1)]);
const revision = z.number().int().nonnegative().safe();
const zone = z.enum(['hand', 'battlefield', 'graveyard', 'exile', 'libraryTop', 'libraryBottom', 'hosted']);
const host = z.object({ cardUuid: uuid, zoneRevision: revision, visibility: z.enum(['hidden', 'owner', 'public']) }).strict();
const mana = z.object({ white: revision.max(1000), blue: revision.max(1000), black: revision.max(1000), red: revision.max(1000), green: revision.max(1000), yellow: revision.max(1000) }).strict();
export const PLAYTEST_PHASES = ['upkeepStep', 'stateDrawPhase', 'stateMainPhase', 'beginCombatStep', 'declareAttackersStep', 'postcombatMainPhase', 'stateEndPhase'] as const;
const checkpointName = z.string().trim().min(1).max(60);
const target = z.object({ targetType: z.enum(['self', 'player', 'permanent', 'card', 'spell', 'stack', 'zone', 'any']),
  playerId: uuid.optional(), cardUuid: uuid.optional(), stackUuid: uuid.optional(), zoneRevision: revision.optional(), zone: z.string().max(32).optional() }).strict();
const announcement = z.object({ targets: z.array(target).max(30).optional(),
  targetGroups: z.array(z.object({ id: z.string().max(80), targets: z.array(target).max(30) }).strict()).max(20).optional(),
  modes: z.array(z.string().max(80)).max(20).optional(), numericBindings: z.record(z.string().max(40), revision.max(100000)).optional(),
  distributions: z.record(z.string().max(40), z.record(z.string().max(128), revision.max(100000))).optional(),
  costRoute: z.union([z.object({ kind: z.literal('base') }).strict(), z.object({ kind: z.literal('alternative'), id: z.string().max(80) }).strict()]).optional(),
}).strict();
export const PlaytestLaunchSchema = z.object({ protocolVersion: version, scenario: ScenarioSchema, source: z.object({ id: uuid, revision: revision.positive() }).strict().optional() }).strict();
export const PlaytestCredentialsSchema = z.object({ protocolVersion: version, run: ScenarioRunSchema, editor: SessionTokenSchema,
  seats: z.tuple([SessionTokenSchema, SessionTokenSchema]), retained: z.literal(true).optional() }).strict();
export const OperatorTestRoomsSchema = z.object({ protocolVersion: version, rooms: z.array(z.object({
  roomId: uuid, name: z.string().min(1).max(80), createdAt: revision, retainedUntil: revision.nullable(),
}).strict()).max(100) }).strict();
export const PlaytestSeatAuthSchema = z.object({ protocolVersion: version, playtestToken: SessionTokenSchema, roomId: uuid }).strict();
export const PlaytestEditSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('add'), cardId: CardIdSchema, seat, zone, host: host.optional(), quantity: z.number().int().min(1).max(20) }).strict(),
  z.object({ kind: z.literal('stageSpell'), cardId: CardIdSchema, seat, announcement: announcement.optional() }).strict(),
  z.object({ kind: z.literal('stageAbility'), cardUuid: uuid, zoneRevision: revision, abilityId: z.string().min(1).max(200), announcement: announcement.optional() }).strict(),
  z.object({ kind: z.literal('move'), cardUuid: uuid, zoneRevision: revision, seat, zone, host: host.optional() }).strict(),
  z.object({ kind: z.literal('remove'), cardUuid: uuid, zoneRevision: revision }).strict(),
  z.object({ kind: z.literal('player'), seat, life: z.number().int().min(1).max(1000), mana, landPlaysUsed: revision.max(1000).optional() }).strict(),
  z.object({ kind: z.literal('permanent'), cardUuid: uuid, zoneRevision: revision, tapped: z.boolean(), summoningSickness: z.boolean(), damage: revision.max(1000), counter: z.object({ name: z.string().regex(/^[a-z][a-z0-9_+-]{0,39}$/i), amount: revision.max(1000) }).strict().optional() }).strict(),
  z.object({ kind: z.literal('turn'), seat, priority: seat, turnNumber: revision.min(1).max(100000), phase: z.enum(PLAYTEST_PHASES) }).strict(),
  z.object({ kind: z.literal('token'), cardId: CardIdSchema, seat, quantity: revision.min(1).max(20) }).strict(),
  z.object({ kind: z.literal('attach'), cardUuid: uuid, zoneRevision: revision, hostUuid: uuid.nullable(), hostRevision: revision }).strict(),
  z.object({ kind: z.literal('modifier'), cardUuid: uuid, zoneRevision: revision,
    power: z.number().int().min(-1000).max(1000), toughness: z.number().int().min(-1000).max(1000), duration: z.enum(['END_OF_TURN', 'WHILE_ON_BATTLEFIELD']) }).strict(),
]);
export type PlaytestEdit = z.infer<typeof PlaytestEditSchema>;
export type PlaytestZone = z.infer<typeof zone>;
export type PlaytestCredentials = z.infer<typeof PlaytestCredentialsSchema>;
export const PlaytestRecipeSchema = z.object({ format: z.literal('card-game-playtest-edits'), version, edits: z.array(PlaytestEditSchema).min(1).max(30) }).strict();
export const PlaytestEditRequestSchema = z.union([
  z.object({ protocolVersion: version, expectedRevision: revision, edit: PlaytestEditSchema }).strict(),
  z.object({ protocolVersion: version, expectedRevision: revision, recipe: PlaytestRecipeSchema }).strict(),
]);
export type PlaytestRecipe = z.infer<typeof PlaytestRecipeSchema>;
const simpleCommand = z.object({ kind: z.enum(['undo', 'reset', 'play', 'edit']) });
const namedCommand = z.object({ kind: z.enum(['saveCheckpoint', 'restoreCheckpoint']), name: checkpointName });
const requestFields = { protocolVersion: version, expectedRevision: revision };
export const PlaytestCommandSchema = z.union([simpleCommand.extend(requestFields).strict(), namedCommand.extend(requestFields).strict()]);
export type PlaytestCommand = z.infer<typeof simpleCommand> | z.infer<typeof namedCommand>;
const resourceView = z.object({ id: uuid, life: z.number(), mana: z.record(z.enum(['white', 'blue', 'black', 'red', 'green', 'yellow']), revision), landPlaysUsed: revision }).strict();
export const PlaytestStateSchema = z.object({ protocolVersion: version, roomId: uuid, revision, editing: z.boolean(), canUndo: z.boolean(),
  history: z.array(z.string()).max(30), message: z.string(), players: z.tuple([resourceView, resourceView]),
  turn: z.object({ seat, priority: seat.nullable(), number: revision.min(1), phase: z.string() }).strict(),
  tokens: z.array(z.object({ cardId: CardIdSchema, name: z.string() }).strict()),
  stack: z.array(z.object({ uuid, name: z.string(), seat }).strict()),
  checkpoints: z.array(checkpointName).max(12),
  cards: z.array(z.object({ uuid, zoneRevision: revision, name: z.string(), zone: z.string(), seat, tapped: z.boolean(), summoningSickness: z.boolean(), damage: revision, counters: z.record(z.string(), z.number()), equipment: z.boolean(), activatedAbilities: z.array(z.string()) }).strict()) }).strict();
export type PlaytestState = z.infer<typeof PlaytestStateSchema>;
export const PLAYTEST_SESSION_KEY = 'cardgame.playtest.v1';
