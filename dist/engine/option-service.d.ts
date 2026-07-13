import type { GameRoom, PlayerId } from '../types/game.room.types';
export interface ActionOption {
    actionId: string;
    label: string;
    description?: string;
    disabled?: boolean;
    disabledReason?: string;
}
export declare class OptionService {
    getOptions(room: GameRoom, playerId: PlayerId, cardUuid: string, zone: 'hand' | 'battlefield'): ActionOption[];
    private findCard;
    private getHandOptions;
    private getBattlefieldOptions;
}
//# sourceMappingURL=option-service.d.ts.map