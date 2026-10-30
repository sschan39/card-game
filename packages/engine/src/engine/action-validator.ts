import { isActionTimingAllowed, declarationPlayer } from '../shared/turn-utils';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { CardInstance } from '../types/card.types';
import type { ActionCondition, ActionCost, ActionRequirements, TargetingDefinition, TargetPointer } from '../types/effect.types';
import { ManaPool } from './mana-pool';
import { CardCharacteristicService } from './card-characteristic-service';
import { actionPermission } from '../shared/action-permissions';

import { structuralTargetLegal, targetKey } from '../shared/target-legality';
import { materializeAnnouncementCost } from './announcement-values';

/**
 * Result of an activation check. A rejection always carries a reason, so callers
 * never have to invent a fallback message for a failure that has none.
 */
export type ActivationCheck =
    | { valid: true }
    | { valid: false; reason: string };

/**
 * Utility class handling pure verification rules for card activations and game actions.
 * Evaluates the intersection of game state constraints, resource economies, and priority mechanics.
 */
export class ActionValidator {

    /**
     * Pure function to evaluate if contextual, read-only board conditions are met.
     * * Verifies game states such as checking card counts within target card zones,
     * matching specific card definitions/types, and confirming turn milestones via global indicators.
     * * @param room - The snapshot of the active game room instance.
     * @param playerId - The ID of the player whose perspective/conditions are being queried.
     * @param condition - Optional criteria parameters defining required game-state configurations.
     * * @returns `true` if all specified conditions pass or if no condition parameters are provided; otherwise, `false`.
     */
    public static canMeetCondition(room: GameRoom, playerId: PlayerId, condition?: ActionCondition): boolean {
        if (!condition) return true; // No conditions required

        const player = room.players[playerId];
        const opponentId = room.player1Id === playerId ? room.player2Id : room.player1Id;

        // 1. Check if "something exists somewhere"
        if (condition.zoneCheck) {
            const check = condition.zoneCheck;
            let targetCards: CardInstance[] = [];

            // Determine which player's zone to look into
            if (check.ownedBy === 'self' || check.ownedBy === 'any') {
                if (check.zone.includes('battlefield')) targetCards.push(...room.battlefield.filter(c => CardCharacteristicService.resolveController(room, c) === playerId));
                if (check.zone.includes('graveyard')) targetCards.push(...player.graveyard);
                if (check.zone.includes('hand')) targetCards.push(...player.hand);
            }
            if ((check.ownedBy === 'opponent' || check.ownedBy === 'any') && opponentId) {
                const opponent = room.players[opponentId];
                if (check.zone.includes('battlefield')) targetCards.push(...room.battlefield.filter(c => CardCharacteristicService.resolveController(room, c) === opponentId));
                if (check.zone.includes('graveyard')) targetCards.push(...opponent.graveyard);
                if (check.zone.includes('hand')) targetCards.push(...opponent.hand);
            }

            // Filter by Card Type if specified (e.g., must be a "Creature")
            if (check.cardType) {
                targetCards = targetCards.filter(c => CardCharacteristicService.resolveTypes(room, c).includes(check.cardType!));
            }

            // Filter by absolute Card ID if specified (e.g., must be a specific named card)
            if (check.cardId) {
                targetCards = targetCards.filter(c => c.blueprint.id === check.cardId);
            }

            const requiredCount = check.minCount ?? 1;
            if (targetCards.length < requiredCount) return false;
        }

        // 2. Check Global Flags (e.g., tracking tracking system markers for the turn)
        if (condition.globalFlag) {
            // NOTE: Ensure your turnHistory system integrates properly here to avoid false negatives.
            // if (condition.globalFlag === 'creatureDiedThisTurn') { 
            //     const hasDied = room.turnHistory?.creatureDied ?? false;
            //     if (!hasDied) return false;
            // }
        }

        return true;
    }

    /**
     * Evaluates if mutable player or card resources can cover an action's economic cost.
     * * Assesses independent currency brackets including mana variables, vital point depletion,
     * physical orientation changes (tapping), or required card discards.
     * * @param room - The snapshot of the active game room instance.
     * @param playerId - The ID of the player attempting to pay the cost.
     * @param card - The specific instance originating the action (crucial for checking tap-state availability).
     * @param cost - Optional resource configurations listing operational costs.
     * * @returns `true` if the player's capital fully matches or exceeds all fields inside the cost profile; otherwise, `false`.
     */
    public static canPayCost(room: GameRoom, playerId: PlayerId, card: CardInstance, cost?: ActionCost): boolean {
        if (!cost) return true;
        const player = room.players[playerId];

        // Mana cost check
        if (cost.mana && !ManaPool.canPay(player.mana, cost.mana)) {
            return false;
        }

        if (cost.life && player.life < cost.life) return false;
        if (cost.tap && card.state.isTapped) return false;
        if (cost.untap && !card.state.isTapped) return false;
        if (cost.tap && cost.untap) return false;
        if (cost.loyalty !== undefined) return false;
        if (cost.discardSelf && !player.hand.some(source => source.uuid === card.uuid && source.state.zone === 'hand' && (source.state.zoneRevision ?? 0) === (card.state.zoneRevision ?? 0))) return false;
        if (cost.sacrifice && !room.battlefield.some(c => c.uuid === card.uuid && CardCharacteristicService.resolveController(room, c) === playerId)) return false;

        // Summoning sickness (CR 302.6): a creature with summoning sickness
        // cannot pay a {T} (or {Q}) activation cost. Abilities WITHOUT a tap
        // cost are unaffected — e.g. "{R}: +1/+0" works even while sick.
        if ((cost.tap || cost.untap) && CardCharacteristicService.resolveTypes(room, card).includes('Creature') && card.state.summoningSickness && !CardCharacteristicService.resolveKeywords(room, card).includes('Haste')) {
            return false;
        }

        // Discard cost check
        if (cost.discard && player.hand.length < cost.discard) return false;

        return true;
    }

    /**
     * Pure structural legality check for a set of chosen targets against a
     * targeting definition (CR 601.2c — targets are announced at cast time).
     *
     * This is a PURE function: it reads `room` but never mutates it, so it is
     * safe to re-evaluate mid-flight (e.g. when a target becomes illegal between
     * announce and resolve). It checks only *structural* legality — that the
     * target count is within [minTargets, maxTargets], the target exists in the
     * expected zone, and any cardTypes/subTypes/controller filters match.
     *
     * Permission-style checks (hexproof, shroud, protection) are intentionally
     * NOT here — those live in ModifierRegistry.canTarget().
     *
     * @param room - The snapshot of the active game room instance.
     * @param playerId - The ID of the player choosing the targets.
     * @param card - The card instance originating the action.
     * @param targets - The TargetPointers the player has chosen.
     * @param def - The targeting definition describing what is legal.
     * @returns `true` if all targets are structurally legal; otherwise `false`.
     */
    public static canTarget(
        room: GameRoom,
        playerId: PlayerId,
        card: CardInstance,
        targets: TargetPointer[],
        def: TargetingDefinition
    ): boolean {
        // 1. Count bounds
        const min = def.minTargets ?? (def.required ? 1 : 0);
        const max = def.maxTargets ?? targets.length;
        if (targets.length < min) return false;
        if (targets.length > max) return false;
        if (new Set(targets.map(targetKey)).size !== targets.length) return false;

        // 2. If no targets required and none provided, nothing more to check.
        if (targets.length === 0) return true;

        // 3. Per-target structural legality
        return targets.every(target => structuralTargetLegal(room, playerId, target, def));
    }

    /**
     * The master evaluation pipeline for validating ANY unified card deployment or capability activation.
     * * This orchestrates validation sequentially across five core game systems:
     * 1. **Zone Eligibility:** Confirming if the item is nested in an allowed zone context.
     * 2. **Timing Speed Constraints:** Blocking sorcery items when stacks are active or outside main turn cycles.
     * 3. **Environmental State Requirements:** Ensuring state conditions (targets/board conditions) are viable.
     * 4. **Economic Sufficiency:** Validating that life, cards, and energy types are completely payable.
     * 5. **System Engine Priority:** Guaranteeing the invoking player actually possesses active priority rights.
     * * @param room - The snapshot of the active game room instance.
     * @param playerId - The ID of the player triggering the interface sequence.
     * @param card - The target instance attempting an interface change or action execution.
     * @param req - The unified rules object capturing allowed parameters, speeds, conditions, and costs.
     * * @returns A discriminated result: `{ valid: true }` or `{ valid: false, reason }`. A rejection
     * always carries a human-readable reason, so callers never have to invent a fallback message.
     */
    public static canActivate(
        room: GameRoom, 
        playerId: PlayerId, 
        card: CardInstance, 
        req: ActionRequirements,
        action: 'cast' | 'activate' = card.state.zone === 'hand' ? 'cast' : 'activate',
        abilityId?: string,
    ): ActivationCheck {
        if (declarationPlayer(room) && !room.stack.length) return { valid: false, reason: 'Combat declaration is required' };
        const permission = actionPermission(room, playerId, card, action, abilityId);
        if (!permission.allowed) return { valid: false, reason: `An effect prohibits this ${action} action` };
        
        // 1. Zone permission check
        if (!req.allowedZones.includes(card.state.zone)) {
            return { valid: false, reason: `Action cannot be initiated from ${card.state.zone}` };
        }

        // 2. Timing check
        if (!permission.instant && !isActionTimingAllowed(room, playerId, req.speed)) {
            return { valid: false, reason: "Can only perform this action at sorcery speed during your main phase." };
        }

        // 3. Condition verification ("If something exists somewhere")
        if (!this.canMeetCondition(room, playerId, req.condition)) {
            return { valid: false, reason: "Game state conditions for this action are not met." };
        }

        // 4. Resource Cost verification
        let cost: ActionCost;
        try { cost = materializeAnnouncementCost(req.cost); }
        catch { return { valid: false, reason: 'Choose numbers before checking cost affordability' }; }
        if (!this.canPayCost(room, playerId, card, cost)) {
            return { valid: false, reason: "Cannot afford the resource costs for this action." };
        }

        // 5. Player Priority Verification
        if (room.priorityPlayerId !== playerId) {
            return { valid: false, reason: "You do not have priority to act right now." };
        }

        return { valid: true };
    }
}
