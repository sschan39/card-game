import { z } from 'zod';
import defaults from './ui.json';

export const builderConfig = Object.freeze(z.object({
  pageSize: z.number().int().min(1).max(100),
  sessionKey: z.literal('cardgame.builderSession.v1'), draftKey: z.literal('cardgame.builderDraft.v1'),
  maxImportBytes: z.number().int().min(1024).max(65536),
  developmentGameUrl: z.url(), gamePath: z.literal('/'),
}).strict().parse(defaults));
