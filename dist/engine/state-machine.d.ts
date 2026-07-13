import { EventBus } from './event-bus';
import type { GameStateName } from '../types/game.state.types';
import type { PlayerId } from '../types/game.room.types';
import type { StackObject } from '../types/effect.types';
export declare class StateMachine {
    readonly roomId: string;
    private player1;
    private player2;
    private eventBus;
    currentPhase: GameStateName;
    previousPhase: GameStateName | null;
    currentPlayer: PlayerId;
    priorityPlayer: PlayerId | null;
    lastPlayerToPass: PlayerId | null;
    waitingForResponse: boolean;
    stackOpen: boolean;
    stack: StackObject[];
    constructor(roomId: string, player1: PlayerId, player2: PlayerId, eventBus: EventBus);
    canTransition(to: GameStateName): boolean;
    transition(to: GameStateName): void;
    switchTurn(): void;
    isPlayerTurn(playerId: PlayerId): boolean;
    givePriorityTo(playerId: PlayerId): void;
    passPriority(playerId: PlayerId): boolean;
    resolveCurrentPhase(): void;
    addToStack(stackObj: StackObject): void;
}
//# sourceMappingURL=state-machine.d.ts.map