import { describe, expect, it } from 'vitest';
import type { PlayerView } from '@card-game/protocol';
import { translate, type Translate } from '@card-game/ui';
import { actionLabel, phaseLabel } from '@client/display-labels';

type Phase = PlayerView['phase'];

const en: Translate = (key, params) => translate('en', key, params);
const zhHant: Translate = (key, params) => translate('zh-Hant', key, params);

describe('display labels', () => {
  it('names every protocol phase in both languages', () => {
    expect(phaseLabel('stateTurnStart', en)).toBe('Untap Step');
    expect(phaseLabel('stateMainPhase', en)).toBe('Precombat Main');
    expect(phaseLabel('declareBlockersStep', en)).toBe('Declare Blockers');
    expect(phaseLabel('cleanupStep', en)).toBe('Cleanup Step');
    expect(phaseLabel('stateMainPhase', zhHant)).toBe('戰鬥前主階段');
    expect(phaseLabel('cleanupStep', zhHant)).toBe('清除步驟');
  });

  it('falls back to the raw phase for a value the protocol does not ship', () => {
    expect(phaseLabel('notAPhase' as Phase, en)).toBe('notAPhase');
  });

  it('names every action id in both languages, including the camelCase ids', () => {
    expect(actionLabel('cast_spell', en)).toBe('Cast spell');
    expect(actionLabel('cast_spell', zhHant)).toBe('施放咒語');
    expect(actionLabel('pass_priority', zhHant)).toBe('讓過優先權');
    expect(actionLabel('tapForMana', zhHant)).toBe('橫置取法力');
    expect(actionLabel('rpsPlay', en)).toBe('RPS play');
    expect(actionLabel('concede', en)).toBe('Concede');
    expect(actionLabel('resolve_stack', zhHant)).toBe('結算堆疊');
  });

  it('keeps an unknown action id visible instead of blanking it', () => {
    expect(actionLabel('mystery_action', en)).toBe('mystery_action');
    expect(actionLabel('', zhHant)).toBe('');
  });
});
