import type { CardObservationView, CardView, ClientLocale, ObservedCardView, PlayerView } from '@card-game/protocol';
import { getBlueprint } from '@card-game/engine/library/card-catalog';
import { resolveCardText, type ResolvedCardText } from '@card-game/engine/shared/localized-card-text';

/** Translation for one definition, or null when the catalog does not know it. */
function textFor(definitionId: string, locale: ClientLocale): ResolvedCardText | null {
  try {
    return resolveCardText(getBlueprint(definitionId), locale);
  } catch {
    /* A view can outlive a definition (fixtures, tokens from an older build): keep the
       projected text rather than failing the whole snapshot for one unknown id. */
    return null;
  }
}

function localizeCard(card: CardView, locale: ClientLocale): CardView {
  const text = textFor(card.definitionId, locale);
  if (!text) return card;
  /* `label` carries a printed suffix when identical permanents share a name
     ("Fireball #2"), so it is only rewritten while it is still just the card name. */
  const label = card.label === card.name ? text.name : card.label;
  return { ...card, name: text.name, label, rulesText: text.rulesText, subTypes: [...text.subTypes] };
}

function localizeObserved(card: ObservedCardView, locale: ClientLocale): ObservedCardView {
  const text = textFor(card.definitionId, locale);
  if (!text) return card;
  return { ...card, name: text.name, rulesText: text.rulesText, subTypes: [...text.subTypes] };
}

function localizeObservation(entry: CardObservationView, locale: ClientLocale): CardObservationView {
  if (!entry.cards) return entry;
  return { ...entry, cards: entry.cards.map(card => localizeObserved(card, locale)) };
}

/**
 * Re-project the visible card text for one connection's language.
 *
 * This is a post-pass over the finished view on purpose: the projectors already
 * decided *what* a viewer may see, and this pass only swaps the words. Keeping the
 * decision and the wording separate means a missing translation degrades to the
 * authored text instead of dropping the card.
 */
export function applyViewLocale(view: PlayerView, locale: ClientLocale): PlayerView {
  /* Card text is authored in Traditional Chinese, so that locale is already correct. */
  if (locale === 'zh-Hant') return view;
  return {
    ...view,
    players: Object.fromEntries(Object.entries(view.players).map(([id, player]) => [id, {
      ...player,
      hand: player.hand.map(card => localizeCard(card, locale)),
      graveyard: player.graveyard.map(card => localizeCard(card, locale)),
      exile: player.exile.map(card => localizeCard(card, locale)),
    }])),
    battlefield: view.battlefield.map(card => localizeCard(card, locale)),
    stack: view.stack.map(entry => entry.source ? { ...entry, source: localizeCard(entry.source, locale) } : entry),
    combat: view.combat.map(entry => ({
      ...entry,
      attacker: localizeCard(entry.attacker, locale),
      blockers: entry.blockers.map(card => localizeCard(card, locale)),
    })),
    ...(view.hostedCards ? {
      hostedCards: view.hostedCards.map(host => ({ ...host, cards: host.cards.map(card => localizeCard(card, locale)) })),
    } : {}),
    ...(view.observations ? {
      observations: {
        active: view.observations.active.map(entry => localizeObservation(entry, locale)),
        history: view.observations.history.map(entry => localizeObservation(entry, locale)),
      },
    } : {}),
  };
}
