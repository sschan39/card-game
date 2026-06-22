// src/library/CardParser.ts
// TypeScript port of CardParser.js

import type { ManaColor, ManaCost } from '../types/card.types';

const COLOR_MAP: Record<string, Exclude<ManaColor, 'generic'>> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green'
};

export function parseManaString(manaStr?: string | null): ManaCost {
  if (!manaStr || manaStr === '{0}' || manaStr.trim() === '') return {};
  const regex = /\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  const cost: Record<string, number> = {};
  while ((match = regex.exec(manaStr)) !== null) {
    const token = match[1];
    if (/^\d+$/.test(token)) {
      cost.generic = (cost.generic || 0) + parseInt(token, 10);
    } else if (token.length === 1 && COLOR_MAP[token]) {
      const colorName = COLOR_MAP[token];
      cost[colorName] = (cost[colorName] || 0) + 1;
    } else {
      cost[token] = (cost[token] || 0) + 1;
    }
  }
  return cost as ManaCost;
}

export function parseAbilityCost(cost: any): any {
  if (typeof cost === 'string') return parseManaString(cost);
  if (typeof cost === 'object' && cost !== null) return cost;
  return {};
}

export function normalizeAbilityCost(cost: any): { tap: boolean; mana: Record<string, number> | null } {
  if (cost == null) return { tap: false, mana: null };

  if (typeof cost === 'string') {
    return { tap: false, mana: parseManaString(cost) };
  }

  if (typeof cost === 'object') {
    const normalized: any = { ...cost };
    normalized.tap = !!cost.tap;

    if (cost.mana == null || cost.mana === '') {
      normalized.mana = null;
    } else if (typeof cost.mana === 'string') {
      normalized.mana = parseManaString(cost.mana);
    }
    return { tap: !!normalized.tap, mana: normalized.mana };
  }

  return { tap: false, mana: null };
}

export function normalizeAbility(ability: any): any | null {
  if (!ability || typeof ability !== 'object') return null;

  const normalized: any = { ...ability };
  normalized.type = normalized.type || 'activated';
  normalized.cost = normalizeAbilityCost(normalized.cost);

  if (typeof normalized.effectId === 'string') {
    normalized.effectId = normalized.effectId.toUpperCase();
  }

  return normalized;
}

export function normalizeCard(raw: any): any {
  const card: any = {};
  card.id = raw.id || raw.cardId || null;
  card.name = raw.name || '';
  card.isLegendary = raw.isLegendary || false;
  card.manaCost = parseManaString(raw.manaCost);
  card.manaValue = raw.manaValue || null;
  card.colors = raw.colors || [];
  card.colorIdentity = raw.colorIdentity || [];

  card.superTypes = raw.superTypes || [];
  card.cardTypes = raw.cardTypes || (raw.type ? [raw.type] : []);
  card.subTypes = raw.subTypes || raw.subtypes || [];

  card.power = raw.power ?? raw.basePower ?? null;
  card.toughness = raw.toughness ?? raw.baseToughness ?? raw.health ?? null;

  card.rulesText = raw.rulesText || raw.text || raw.rules || '';
  card.flavorText = raw.flavorText || '';

  card.keywords = raw.keywords || [];
  
  const legacyActivatedAbilities = (raw.activatedAbilities || []).map((a: any) => normalizeAbility({
    type: 'activated',
    cost: a.cost,
    effectId: a.effectId || a.effect || null,
    params: a.params || a.modifier || null,
    duration: a.duration || null
  })).filter(Boolean);

  const parsedAbilities = (raw.abilities || []).map(normalizeAbility).filter(Boolean);
  card.abilities = parsedAbilities.length > 0 ? parsedAbilities : legacyActivatedAbilities;
  
  card.activatedAbilities = card.abilities.filter((a: any) => a.type === 'activated');
  card.triggeredAbilities = raw.triggeredAbilities || card.abilities.filter((a: any) => a.type === 'triggered');

  card.onPlay = raw.onPlay || null;
  card.onTap = raw.onTap || null;
  card.onboardOne = raw.onboardOne || null;

  const tapAbility = card.abilities.find((a: any) => a.type === 'activated' && a.cost?.tap && a.effectId === 'ADD_MANA');
  if (tapAbility) {
    const tapColor = tapAbility.params?.color;
    const tapAmount = tapAbility.params?.amount ?? 1;
    if (tapColor) card.manaTap = { [tapColor]: tapAmount };
  }
  if (raw.manaTap) card.manaTap = parseManaString(raw.manaTap);

  card.set = raw.set || null;
  card.setNumber = raw.setNumber || null;
  card.rarity = raw.rarity || 'Common';
  card.artist = raw.artist || null;
  card.imageURL = raw.imageURL || null;

  card.cost = card.manaCost || {};
  card.isHidden = raw.isHidden || false;

  const types = (card.cardTypes || []).map((t: any) => String(t).toLowerCase());
  if (types.includes('land')) card.type = 'land';
  else if (types.includes('creature')) card.type = 'minion';
  else card.type = raw.type || 'spell';

  return card;
}

export function parseAll(rawMap: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  Object.keys(rawMap).forEach(k => {
    out[k] = normalizeCard(rawMap[k]);
  });
  return out;
}

export default {
  parseManaString,
  parseAbilityCost,
  normalizeCard,
  parseAll
};
