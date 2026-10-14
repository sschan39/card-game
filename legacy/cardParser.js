// cardParser.js
// Provides utilities to parse string-form card JSON into engine-friendly blueprint objects.

const COLOR_MAP = {
  'W': 'white',
  'U': 'blue',
  'B': 'black',
  'R': 'red',
  'G': 'green'
};

function parseManaString(manaStr) {
  if (!manaStr || manaStr === '{0}' || manaStr.trim() === '') return {};
  const regex = /\{([^}]+)\}/g;
  let match;
  const cost = {};
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
  return cost;
}

function parseAbilityCost(cost) {
  if (typeof cost === 'string') return parseManaString(cost);
  if (typeof cost === 'object' && cost !== null) return cost;
  return {};
}

function normalizeAbilityCost(cost) {
  if (cost == null) return { tap: false, mana: null };

  if (typeof cost === 'string') {
    return { tap: false, mana: parseManaString(cost) };
  }

  if (typeof cost === 'object') {
    const normalized = { ...cost };
    normalized.tap = !!cost.tap;

    if (cost.mana == null || cost.mana === '') {
      normalized.mana = null;
    } else if (typeof cost.mana === 'string') {
      normalized.mana = parseManaString(cost.mana);
    }
    return normalized;
  }

  return { tap: false, mana: null };
}

function normalizeAbility(ability) {
  if (!ability || typeof ability !== 'object') return null;

  const normalized = { ...ability };
  normalized.type = normalized.type || 'activated';
  normalized.cost = normalizeAbilityCost(normalized.cost);

  if (typeof normalized.effectId === 'string') {
    normalized.effectId = normalized.effectId.toUpperCase();
  }

  return normalized;
}

function normalizeCard(raw) {
  const card = {};
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
  
  // Normalize abilities
  const legacyActivatedAbilities = (raw.activatedAbilities || []).map(a => normalizeAbility({
    type: 'activated',
    cost: a.cost,
    effectId: a.effectId || a.effect || null,
    params: a.params || a.modifier || null,
    duration: a.duration || null
  })).filter(Boolean);
  
  const parsedAbilities = (raw.abilities || []).map(normalizeAbility).filter(Boolean);
  card.abilities = parsedAbilities.length > 0 ? parsedAbilities : legacyActivatedAbilities;
  
  card.activatedAbilities = card.abilities.filter(a => a.type === 'activated');
  card.triggeredAbilities = raw.triggeredAbilities || card.abilities.filter(a => a.type === 'triggered');

  // Keep the raw hooks/strings; the execution engine or loader will wrap or evaluate these safely.
  card.onPlay = raw.onPlay || null;
  card.onTap = raw.onTap || null;
  card.onboardOne = raw.onboardOne || null;

  // Setup basic tap parameters if explicitly defined by an ability
  const tapAbility = card.abilities.find(a => a.type === 'activated' && a.cost?.tap && a.effectId === 'ADD_MANA');
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

  // Compatibility mapping for older parts of your system
  card.cost = card.manaCost || {};
  card.isHidden = raw.isHidden || false;

  const types = (card.cardTypes || []).map(t => String(t).toLowerCase());
  if (types.includes('land')) card.type = 'land';
  else if (types.includes('creature')) card.type = 'minion';
  else card.type = raw.type || 'spell';

  return card;
}

function parseAll(rawMap) {
  const out = {};
  Object.keys(rawMap).forEach(k => {
    out[k] = normalizeCard(rawMap[k]);
  });
  return out;
}

module.exports = {
  parseManaString,
  parseAbilityCost,
  normalizeCard,
  parseAll
};