import type { CardView, PermanentEffectView } from '@card-game/protocol';
import { cardAnchor } from './board-anchors';

export interface PermanentBadge {
  label: string;
  detail: string;
  tone: 'counter' | 'scorch' | 'damage' | 'effect' | 'restriction';
}

const durationLabels: Record<PermanentEffectView['duration'], string> = {
  turn: 'Until end of turn',
  combat: 'Until end of combat',
  attached: 'While attached',
  source: 'While source effect is active',
  ongoing: 'Ongoing',
};
const signed = (value: number) => value > 0 ? `+${value}` : String(value);

function describePermanentEffect(effect: PermanentEffectView): PermanentBadge {
  const label = effect.kind === 'stats' ? `${signed(effect.power)}/${signed(effect.toughness)}`
    : effect.kind === 'restriction' ? `Can't ${effect.action}` : effect.keyword;
  return {
    label,
    detail: [label, durationLabels[effect.duration], effect.sourceName].filter(Boolean).join(' · '),
    tone: effect.kind === 'restriction' ? 'restriction' : 'effect',
  };
}

export function permanentBadges(card: CardView): PermanentBadge[] {
  const counters = Object.entries(card.state.counters ?? {})
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => Number(b === 'scorch') - Number(a === 'scorch') || a.localeCompare(b))
    .map(([name, count]): PermanentBadge => {
      const label = `${name === 'scorch' ? 'Scorch' : name} ${count}`;
      return { label, detail: label, tone: name === 'scorch' ? 'scorch' : 'counter' };
    });
  const damage = card.state.damageTaken;
  const marked: PermanentBadge[] = damage > 0
    ? [{ label: `${damage} dmg`, detail: `${damage} marked damage`, tone: 'damage' }]
    : [];
  return [...counters, ...marked, ...(card.effects ?? []).map(describePermanentEffect)];
}

/** Only current, projected battlefield objects can appear as attachment tabs. */
export function battlefieldAttachments(cards: readonly CardView[]): Map<string, CardView[]> {
  const hosts = new Map(cards.map(card => [card.uuid, card]));
  const attachments = new Map<string, CardView[]>();
  for (const card of cards) {
    const host = card.state.attachedTo ? hosts.get(card.state.attachedTo) : undefined;
    if (!host || (card.state.attachedToRevision ?? 0) !== (host.state.zoneRevision ?? 0)) continue;
    const key = cardAnchor('battlefield', host);
    const cardsOnHost = attachments.get(key) ?? [];
    cardsOnHost.push(card);
    attachments.set(key, cardsOnHost);
  }
  return attachments;
}
