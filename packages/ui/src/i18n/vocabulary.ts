import type { MessageKey, Translate } from './runtime';

/**
 * Wire vocabulary to display text.
 *
 * Card types and colours arrive as stable enum values from the protocol, so the
 * translation lives on the client: the wire keeps `Creature`, the interface shows
 * 僕從. An unknown value is returned verbatim rather than blanked, so a card that
 * introduces a new type still renders.
 */
const CARD_TYPE_KEYS: Record<string, MessageKey> = {
  Creature: 'type.creature',
  Artifact: 'type.artifact',
  Land: 'type.land',
  Spell: 'type.spell',
  Enchantment: 'type.enchantment',
  Equipment: 'type.equipment',
};

const COLOR_KEYS: Record<string, MessageKey> = {
  white: 'color.white',
  blue: 'color.blue',
  black: 'color.black',
  red: 'color.red',
  green: 'color.green',
  yellow: 'color.yellow',
  colorless: 'color.colorless',
};

/** One card type: `Creature` → 僕從. */
export function cardTypeLabel(type: string, t: Translate): string {
  const key = CARD_TYPE_KEYS[type];
  return key ? t(key) : type;
}

/** One colour: `red` → 紅. */
export function colorLabel(color: string, t: Translate): string {
  const key = COLOR_KEYS[color];
  return key ? t(key) : color;
}

/** Token marker shown where a card face prints its type. */
export function tokenLabel(t: Translate): string {
  return t('type.token');
}

/** Types plus sub-types, joined the way Chinese lists read. */
export function cardTypeLine(cardTypes: readonly string[], subTypes: readonly string[] | undefined, t: Translate): string {
  return [...cardTypes.map(type => cardTypeLabel(type, t)), ...(subTypes ?? [])].join('、');
}

/** Every colour a card has, or 無色 when it has none. */
export function colorLine(colors: readonly string[] | undefined, t: Translate): string {
  return colors?.length ? colors.map(color => colorLabel(color, t)).join('、') : t('color.colorless');
}
