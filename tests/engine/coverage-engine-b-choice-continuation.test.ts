import { beforeEach, describe, expect, it, vi } from 'vitest';
import { answerPendingChoice } from '@engine/choice-continuation';
import { capturedChoiceAllowed } from '../../packages/engine/src/engine/captured-windows';
import { validateChoiceAnswer } from '../../packages/engine/src/engine/choices';
import { answerResolutionPayment } from '../../packages/engine/src/engine/resolution-payments';
import { planStackResolution } from '../../packages/engine/src/engine/effect-resolver';
import { answerStateBasedChoice } from '../../packages/engine/src/engine/state-based-planner';
import { resumeProposedChoice } from '../../packages/engine/src/engine/proposed-events';
import { applyTriggerChoice } from '../../packages/engine/src/engine/trigger-scheduler';
import { applyResolutionChoice } from '../../packages/engine/src/engine/resolution-choices';
import { settleOutcome } from '../../packages/engine/src/engine/resolution-outcomes';
import { settleCardResult } from '../../packages/engine/src/engine/resolution-results';
import { answerCombatDamage } from '../../packages/engine/src/engine/combat-service';
import type { PendingChoice } from '@shared/choice.types';
import { createTestRoom } from '../helpers/test-room-factory';

vi.mock('../../packages/engine/src/engine/captured-windows', () => ({ capturedChoiceAllowed: vi.fn(() => true) }));
vi.mock('../../packages/engine/src/engine/choices', () => ({ validateChoiceAnswer: vi.fn() }));
vi.mock('../../packages/engine/src/engine/resolution-payments', () => ({ answerResolutionPayment: vi.fn() }));
vi.mock('../../packages/engine/src/engine/effect-resolver', () => ({ planStackResolution: vi.fn() }));
vi.mock('../../packages/engine/src/engine/state-based-planner', () => ({ answerStateBasedChoice: vi.fn() }));
vi.mock('../../packages/engine/src/engine/proposed-events', () => ({ resumeProposedChoice: vi.fn() }));
vi.mock('../../packages/engine/src/engine/trigger-scheduler', () => ({ applyTriggerChoice: vi.fn() }));
vi.mock('../../packages/engine/src/engine/resolution-choices', () => ({ applyResolutionChoice: vi.fn() }));
vi.mock('../../packages/engine/src/engine/resolution-outcomes', () => ({ settleOutcome: vi.fn() }));
vi.mock('../../packages/engine/src/engine/resolution-results', () => ({ settleCardResult: vi.fn() }));
vi.mock('../../packages/engine/src/engine/combat-service', () => ({ answerCombatDamage: vi.fn() }));

const stackObj = { type: 'activated', uuid: 'stack-1', source: { uuid: 'src' }, controllerId: 'player1', effects: [], countered: false } as never;

function choice(over: Record<string, unknown> = {}): PendingChoice {
  return {
    id: 'choice-1',
    playerId: 'player1',
    kind: 'options',
    prompt: 'Choose',
    options: [],
    min: 1,
    max: 1,
    continuation: { type: 'action', actionId: 'activate_ability', data: {}, field: 'modes' },
    ...over,
  } as unknown as PendingChoice;
}

function host(room = createTestRoom()) {
  return {
    room,
    isGameOver: false,
    hasPendingRulesWork: false,
    effectContext: {} as never,
    applyMutations: vi.fn((mutations: unknown[]) => [...mutations]),
    identifyChoice: vi.fn((pending: PendingChoice) => ({ ...pending, id: 'identified' })),
    givePriorityTo: vi.fn((playerId: string) => [{ type: 'SET_PRIORITY', playerId }]),
    combatPlanMutations: vi.fn(() => [{ type: 'SET_COMBAT_DAMAGE', state: null }]),
    commitResolution: vi.fn(() => ({ success: true, mutations: [] })),
    resumeActionChoice: vi.fn(() => ({ success: true, mutations: [{ type: 'RESUMED' }] })),
  };
}

function roomWith(over: Record<string, unknown> = {}) {
  const room = createTestRoom();
  return { ...room, pendingChoice: choice(over) };
}

const data = { choiceId: 'choice-1' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(capturedChoiceAllowed).mockReturnValue(true);
  vi.mocked(validateChoiceAnswer).mockReturnValue({ values: [] });
});

describe('answerPendingChoice guards', () => {
  it('rejects a choice owned by another player', () => {
    const h = host(roomWith({ playerId: 'player2' }));
    expect(answerPendingChoice(h as never, 'player1', data)).toEqual({ success: false, phase: 'validate', reason: 'This choice belongs to another player' });
  });

  it('rejects a stale request id', () => {
    const h = host(roomWith());
    expect(answerPendingChoice(h as never, 'player1', { choiceId: 'older' })).toEqual({ success: false, phase: 'validate', reason: 'Choice request is stale' });
  });

  it('rejects a captured card that is no longer accessible', () => {
    vi.mocked(capturedChoiceAllowed).mockReturnValue(false);
    const h = host(roomWith());
    expect(answerPendingChoice(h as never, 'player1', data)).toEqual({
      success: false,
      phase: 'validate',
      reason: 'Captured card access is no longer available',
    });
  });

  it('rejects an answer with no legal value', () => {
    vi.mocked(validateChoiceAnswer).mockReturnValue(undefined);
    const h = host(roomWith());
    expect(answerPendingChoice(h as never, 'player1', data)).toEqual({ success: false, phase: 'validate', reason: 'Invalid choice answer' });
  });
});

describe('answerPendingChoice payment stage', () => {
  const paymentChoice = (over: Record<string, unknown> = {}) =>
    roomWith({ continuation: { type: 'resolution', paymentStage: 'mana_ability', stackObj, continuation: stackObj }, ...over });

  it('rejects a payment answer that no rule can read', () => {
    vi.mocked(validateChoiceAnswer).mockReturnValue(undefined);
    const h = host(paymentChoice());
    expect(answerPendingChoice(h as never, 'player1', data)).toEqual({ success: false, phase: 'validate', reason: 'Invalid payment choice' });
  });

  it('rejects a payment plan that fails', () => {
    vi.mocked(answerResolutionPayment).mockReturnValue({ success: false, reason: 'Not enough mana' } as never);
    const h = host(paymentChoice());
    expect(answerPendingChoice(h as never, 'player1', data)).toEqual({ success: false, phase: 'validate', reason: 'Not enough mana' });
  });

  it('commits a nested payment prompt', () => {
    const pending = { id: 'nested' };
    vi.mocked(answerResolutionPayment).mockReturnValue({ success: true, mutations: [], pendingChoice: pending } as never);
    const h = host(paymentChoice());
    expect(answerPendingChoice(h as never, 'player1', data)).toEqual({ success: true, mutations: [] });
    expect(h.commitResolution).toHaveBeenCalledWith({ success: true, mutations: [], pendingChoice: pending });
  });

  it('resumes the resolution after a completed payment', () => {
    const mutations = [{ type: 'SET_MANA', playerId: 'player1', color: 'red', amount: 2 }];
    vi.mocked(answerResolutionPayment).mockReturnValue({ success: true, mutations, continuation: { stackObj, continuation: stackObj } } as never);
    vi.mocked(planStackResolution).mockReturnValue({ mutations: [{ type: 'POP_STACK' }] } as never);
    const h = host(paymentChoice());
    expect(answerPendingChoice(h as never, 'player1', data)).toEqual({ success: true, mutations: [] });
    expect(h.commitResolution).toHaveBeenCalledWith(expect.objectContaining({ success: true, mutations: [...mutations, { type: 'POP_STACK' }] }));
  });

  it('treats a cancelled payment as an unanswered choice', () => {
    vi.mocked(answerResolutionPayment).mockReturnValue({ success: false, reason: 'Payment cancelled' } as never);
    const h = host(paymentChoice());
    expect(answerPendingChoice(h as never, 'player1', { choiceId: 'choice-1', cancel: true })).toEqual({
      success: false,
      phase: 'validate',
      reason: 'Payment cancelled',
    });
    expect(vi.mocked(answerResolutionPayment)).toHaveBeenCalledWith(expect.anything(), expect.anything(), undefined, true);
  });
});

describe('answerPendingChoice action choices', () => {
  it('clears the pending state when the player cancels', () => {
    const h = host(roomWith());
    expect(answerPendingChoice(h as never, 'player1', { choiceId: 'choice-1', cancel: true })).toEqual({
      success: true,
      mutations: [
        { type: 'SET_PENDING_CHOICE', choice: null },
        { type: 'SET_PENDING_TRIGGERS', mutations: [] },
      ],
    });
  });

  it('resumes the action with the applied answer', () => {
    const h = host(roomWith());
    expect(answerPendingChoice(h as never, 'player1', data)).toEqual({ success: true, mutations: [{ type: 'RESUMED' }] });
    expect(h.resumeActionChoice).toHaveBeenCalledWith('player1', expect.objectContaining({ type: 'action' }), { values: [] });
  });
});

describe('answerPendingChoice state-based decisions', () => {
  const stateChoice = () => roomWith({ continuation: { type: 'state_based', batch: { resumePriority: 'player1' } } });

  it('reports a planner error', () => {
    vi.mocked(answerStateBasedChoice).mockImplementation(() => {
      throw new Error('Unknown counter');
    });
    const h = host(stateChoice());
    expect(answerPendingChoice(h as never, 'player1', data)).toEqual({ success: false, phase: 'validate', reason: 'Unknown counter' });
  });

  it('reports a non-Error planner failure', () => {
    vi.mocked(answerStateBasedChoice).mockImplementation(() => {
      throw 'plain';
    });
    const h = host(stateChoice());
    expect(answerPendingChoice(h as never, 'player1', data)).toEqual({ success: false, phase: 'validate', reason: 'Invalid state-based decision' });
  });

  it('asks the next decision without committing the batch', () => {
    vi.mocked(answerStateBasedChoice).mockReturnValue({ mutations: [], pendingChoice: { id: 'next' } } as never);
    const h = host(stateChoice());
    expect(answerPendingChoice(h as never, 'player1', data)).toEqual({
      success: true,
      mutations: [{ type: 'SET_PENDING_CHOICE', choice: { id: 'identified' } }],
    });
  });

  it('commits the batch and returns priority', () => {
    vi.mocked(answerStateBasedChoice).mockReturnValue({ mutations: [{ type: 'CLEAR_DAMAGE' }] } as never);
    const h = host(stateChoice());
    const result = answerPendingChoice(h as never, 'player1', data);
    expect(result).toEqual({
      success: true,
      mutations: [
        { type: 'SET_PENDING_CHOICE', choice: null },
        { type: 'SET_PENDING_TRIGGERS', mutations: [] },
        { type: 'CLEAR_DAMAGE' },
        { type: 'SET_PRIORITY', playerId: 'player1' },
      ],
    });
    expect(h.applyMutations).toHaveBeenCalledWith(expect.any(Array), undefined, { kind: 'state-based-action' });
  });

  it('keeps priority when the game is over or rules work remains', () => {
    vi.mocked(answerStateBasedChoice).mockReturnValue({ mutations: [] } as never);
    const h = host(stateChoice());
    h.isGameOver = true;
    expect((answerPendingChoice(h as never, 'player1', data) as { mutations: unknown[] }).mutations).toHaveLength(2);
    h.isGameOver = false;
    h.hasPendingRulesWork = true;
    expect((answerPendingChoice(h as never, 'player1', data) as { mutations: unknown[] }).mutations).toHaveLength(2);
  });
});

describe('answerPendingChoice replacement decisions', () => {
  const replacementChoice = (over: Record<string, unknown> = {}) =>
    roomWith({
      continuation: {
        type: 'replacement',
        transaction: { completed: [], remaining: [], resumePriority: 'player1' },
        ...over,
      },
    });

  it('reports a planner error', () => {
    vi.mocked(resumeProposedChoice).mockImplementation(() => {
      throw new Error('Unknown replacement');
    });
    const h = host(replacementChoice());
    expect(answerPendingChoice(h as never, 'player1', data)).toEqual({ success: false, phase: 'validate', reason: 'Unknown replacement' });
  });

  it('reports a non-Error planner failure', () => {
    vi.mocked(resumeProposedChoice).mockImplementation(() => {
      throw 'plain';
    });
    const h = host(replacementChoice());
    expect(answerPendingChoice(h as never, 'player1', data)).toEqual({ success: false, phase: 'validate', reason: 'Invalid replacement decision' });
  });

  it('asks the next replacement question', () => {
    vi.mocked(resumeProposedChoice).mockReturnValue({ mutations: [], pendingChoice: { id: 'next' } } as never);
    const h = host(replacementChoice());
    expect(answerPendingChoice(h as never, 'player1', data)).toEqual({
      success: true,
      mutations: [{ type: 'SET_PENDING_CHOICE', choice: { id: 'identified' } }],
    });
  });

  it('commits the transaction and resumes priority', () => {
    vi.mocked(resumeProposedChoice).mockReturnValue({ mutations: [{ type: 'CLEAR_DAMAGE' }] } as never);
    const h = host(replacementChoice());
    const result = answerPendingChoice(h as never, 'player1', data);
    expect(result).toEqual({
      success: true,
      mutations: [
        { type: 'SET_PENDING_CHOICE', choice: null },
        { type: 'SET_PENDING_TRIGGERS', mutations: [] },
        { type: 'CLEAR_DAMAGE' },
        { type: 'SET_PRIORITY', playerId: 'player1' },
      ],
    });
    expect(h.applyMutations).toHaveBeenCalledWith(expect.any(Array), undefined, undefined);
  });

  it('waits for the player when the transaction has no priority to resume', () => {
    vi.mocked(resumeProposedChoice).mockReturnValue({ mutations: [] } as never);
    const h = host(replacementChoice({ transaction: { completed: [], remaining: [] } }));
    const result = answerPendingChoice(h as never, 'player1', data);
    expect((result as { mutations: unknown[] }).mutations).toContainEqual({ type: 'SET_ENGINE_STATE', state: 'waiting_for_player' });
  });

  it('leaves the engine state alone once the game is over', () => {
    vi.mocked(resumeProposedChoice).mockReturnValue({ mutations: [] } as never);
    const h = host(replacementChoice());
    h.isGameOver = true;
    expect((answerPendingChoice(h as never, 'player1', data) as { mutations: unknown[] }).mutations).toHaveLength(2);
    h.isGameOver = false;
    h.hasPendingRulesWork = true;
    expect((answerPendingChoice(h as never, 'player1', data) as { mutations: unknown[] }).mutations).toHaveLength(2);
  });

  it('resumes the interrupted resolution from the innermost parent transaction', () => {
    vi.mocked(resumeProposedChoice).mockReturnValue({ mutations: [{ type: 'POP_STACK' }] } as never);
    vi.mocked(settleOutcome).mockReturnValue({ type: 'activated', uuid: 'stack-1', settled: true } as never);
    vi.mocked(settleCardResult).mockReturnValue({ type: 'activated', uuid: 'stack-1', settled: true } as never);
    vi.mocked(planStackResolution).mockReturnValue({ mutations: [{ type: 'PUSH_STACK' }] } as never);
    const afterResolution = { stackObj, outcomeProbe: { name: 'win', kind: 'killed', cards: [] }, cardResultProbe: { name: 'card' } };
    const h = host(replacementChoice({
      parents: [{ transaction: { completed: [], remaining: [], cause: { id: 'root' } }, resolution: { stackObj } }],
      afterResolution,
    }));
    expect(answerPendingChoice(h as never, 'player1', data)).toEqual({ success: true, mutations: [] });
    expect(settleOutcome).toHaveBeenCalledWith(h.room, stackObj, afterResolution.outcomeProbe, expect.any(Array));
    expect(settleCardResult).toHaveBeenCalledWith(h.room, expect.anything(), afterResolution.cardResultProbe, expect.any(Array));
    expect(h.commitResolution).toHaveBeenCalledWith(expect.objectContaining({ success: true, mutations: expect.any(Array) }));
  });
});

describe('answerPendingChoice combat and trigger decisions', () => {
  it('rejects an invalid combat allocation', () => {
    vi.mocked(answerCombatDamage).mockReturnValue({ kind: 'reject', error: 'Combat damage plan is stale' } as never);
    const h = host(roomWith({ continuation: { type: 'combat', sourceUuid: 'a', passIndex: 0 } }));
    expect(answerPendingChoice(h as never, 'player1', data)).toEqual({ success: false, phase: 'validate', reason: 'Combat damage plan is stale' });
  });

  it('applies a combat plan and returns priority to the active player', () => {
    vi.mocked(answerCombatDamage).mockReturnValue({ kind: 'complete', mutations: [] } as never);
    const h = host(roomWith({ continuation: { type: 'combat', sourceUuid: 'a', passIndex: 0 } }));
    expect(answerPendingChoice(h as never, 'player1', data)).toEqual({
      success: true,
      mutations: [{ type: 'SET_COMBAT_DAMAGE', state: null }, { type: 'SET_PRIORITY', playerId: 'player1' }],
    });
    expect(h.combatPlanMutations).toHaveBeenCalledWith({ kind: 'complete', mutations: [] });
  });

  it('skips the priority hand-back while rules work remains', () => {
    vi.mocked(answerCombatDamage).mockReturnValue({ kind: 'complete', mutations: [] } as never);
    const h = host(roomWith({ continuation: { type: 'combat', sourceUuid: 'a', passIndex: 0 } }));
    h.hasPendingRulesWork = true;
    expect((answerPendingChoice(h as never, 'player1', data) as { mutations: unknown[] }).mutations).toHaveLength(1);
  });

  it('rejects a trigger choice that leaves no legal queue', () => {
    vi.mocked(applyTriggerChoice).mockReturnValue(undefined);
    const h = host(roomWith({ continuation: { type: 'trigger', field: 'order' } }));
    expect(answerPendingChoice(h as never, 'player1', data)).toEqual({
      success: false,
      phase: 'validate',
      reason: 'Select trigger modes with legal required targets',
    });
  });

  it('installs the answered trigger queue', () => {
    const queue = { entries: [] };
    vi.mocked(applyTriggerChoice).mockReturnValue(queue as never);
    const h = host(roomWith({ continuation: { type: 'trigger', field: 'order' } }));
    expect(answerPendingChoice(h as never, 'player1', data)).toEqual({
      success: true,
      mutations: [
        { type: 'SET_TRIGGER_QUEUE', queue },
        { type: 'SET_PENDING_CHOICE', choice: null },
        { type: 'SET_PENDING_TRIGGERS', mutations: [] },
      ],
    });
  });

  it('continues a resolution choice', () => {
    vi.mocked(applyResolutionChoice).mockReturnValue({ stackObj, continuation: stackObj } as never);
    vi.mocked(planStackResolution).mockReturnValue({ mutations: [{ type: 'POP_STACK' }] } as never);
    const h = host(roomWith({ continuation: { type: 'resolution', stackObj, continuation: stackObj } }));
    expect(answerPendingChoice(h as never, 'player1', data)).toEqual({ success: true, mutations: [] });
    expect(h.commitResolution).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});
