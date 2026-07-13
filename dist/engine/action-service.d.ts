import { type ActionData, type ActionResult } from './action-registry';
import { EventBus } from './event-bus';
import { StateMachine } from './state-machine';
import type { GameRoom, PlayerId } from '../types/game.room.types';
export declare class ActionService {
    private eventBus;
    constructor(eventBus: EventBus);
    handleAction(room: GameRoom, playerId: PlayerId, actionType: string, actionData: ActionData): ActionResult;
    proposeAndStack(room: GameRoom, playerId: PlayerId, actionType: string, actionData: ActionData, stateMachine: StateMachine): ActionResult;
    resolveTopOfStack(room: GameRoom, stateMachine?: StateMachine): ActionResult;
}
//# sourceMappingURL=action-service.d.ts.map