import { Router } from 'express';
import { PlaytestCommandSchema, PlaytestEditRequestSchema, PlaytestStateSchema } from '@card-game/protocol';
import type { GameRoom } from '@card-game/engine/types/game.room.types';
import { bearerToken } from '../auth/routes';
import { AuthError } from '../auth/errors';
import type { AuthService } from '../auth/service';
import type { ScenarioService } from '../scenarios/service';
import type { RoomRuntime } from '../rooms/room-runtime';

export function createPlaytestRouter(service: ScenarioService, runtime: RoomRuntime, auth: AuthService,
  revision: (id: string) => number, publish: (room: GameRoom, revision: number) => void) {
  const router = Router();
  const editor = async (id: string, token?: string) => {
    const access = service.playtestEditor(id, token);
    if (!auth.authority) return access;
    try { await auth.authorize(access.operator, 'lab.operate'); }
    catch (error) {
      if (error instanceof AuthError && error.status === 403) service.revokePlaytests(access.operator.digest);
      throw error;
    }
    return service.playtestEditor(id, token);
  };
  router.get('/:id', async (request, response, next) => {
    try {
      const id = request.params.id;
      const { playtest } = await editor(id, bearerToken(request));
      response.json(PlaytestStateSchema.parse(playtest.state(revision(id))));
    } catch (error) { next(error); }
  });
  router.post('/:id', async (request, response, next) => {
    try {
      const id = request.params.id;
      const { playtest, operator } = await editor(id, bearerToken(request));
      const edit = PlaytestEditRequestSchema.safeParse(request.body);
      const command = PlaytestCommandSchema.safeParse(request.body);
      const input = edit.success ? edit.data : command.success ? command.data : undefined;
      if (!input) throw new AuthError(400, 'Invalid playtest edit.');
      const current = revision(id);
      if (current !== input.expectedRevision) throw new AuthError(409, 'The board changed. Review the current position and try again.');
      const message = 'edit' in input ? playtest.edit([input.edit]) : 'recipe' in input ? playtest.edit(input.recipe.edits) : playtest.command(input);
      publish(runtime.testCheckpoint(id).room, current + 1);
      if (auth.authority) void auth.activity(operator, 'board_edit').catch(() => {});
      response.json(PlaytestStateSchema.parse(playtest.state(current + 1, message)));
    } catch (error) { next(error); }
  });
  return router;
}
