"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBlueprint = getBlueprint;
exports.instantiateCard = instantiateCard;
// src/library/card-factory.ts
const card_data_json_1 = __importDefault(require("../../data/card_data.json"));
const card_parser_1 = require("./card-parser");
const uuid_1 = require("uuid");
const blueprintCache = {};
function getBlueprint(cardId) {
    const raw = card_data_json_1.default[cardId];
    if (!raw) {
        throw new Error(`[CardFactory] No raw card data found for ID: ${cardId}`);
    }
    if (!blueprintCache[cardId]) {
        blueprintCache[cardId] = (0, card_parser_1.normalizeCard)(raw);
    }
    return blueprintCache[cardId];
}
function instantiateCard(cardId) {
    const blueprint = getBlueprint(cardId);
    // Deep clone abilities to prevent shared references
    const abilities = blueprint.abilities.map(a => {
        if (a.type === 'activated') {
            return {
                ...a,
                cost: { ...a.cost, mana: { ...(a.cost?.mana || {}) } },
            };
        }
        return { ...a };
    });
    // Deep clone castRequirements
    const rawCost = blueprint.castRequirements.cost || { mana: {} };
    const castRequirements = {
        ...blueprint.castRequirements,
        allowedZones: [...blueprint.castRequirements.allowedZones],
        cost: {
            ...rawCost,
            mana: { ...(rawCost.mana || {}) },
        },
        condition: blueprint.castRequirements.condition
            ? { ...blueprint.castRequirements.condition }
            : undefined,
    };
    const instance = {
        ...blueprint,
        uuid: (0, uuid_1.v4)(),
        castRequirements,
        abilities,
        state: {
            zone: 'library',
            ownerId: '',
            controllerId: '',
            isTapped: false,
            summoningSickness: blueprint.cardTypes.includes('Creature'),
            damageTaken: 0,
            counters: {},
        },
    };
    return instance;
}
exports.default = { getBlueprint, instantiateCard };
//# sourceMappingURL=card-factory.js.map