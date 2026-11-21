import type { OwnedChoiceView as PendingChoice } from '@card-game/protocol';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useGameStore } from '../store/gameStore';
import { useGameActions } from '../hooks/useGameActions';
import { ACTION_IDS } from '@card-game/protocol';
import { CardTray } from './CardTray';
import { MatchCardFace } from './MatchCardFace';

function usesCardTray(choice: PendingChoice): boolean {
  return choice.kind === 'search' || (choice.kind !== 'number' && choice.kind !== 'distribution' &&
    choice.kind !== 'payment' && choice.options.some(option => option.card));
}

interface ChoiceFormProps {
  choice: PendingChoice;
  selected: string[];
  allocations: Record<string, number>;
  onSelection: (id: string) => void;
  onAllocation: (id: string, amount: number) => void;
  onAnswer: (data: Record<string, unknown>) => void;
  numberText?: string;
  onNumber?: (value: string) => void;
}
export function ChoiceForm({ choice, selected, allocations, onSelection, onAllocation, onAnswer, numberText = '', onNumber }: ChoiceFormProps) {
  if (choice.kind === 'number') {
    const number = Number(numberText);
    const valid = numberText.trim() !== '' && Number.isSafeInteger(number) && number >= choice.range.min && (choice.range.max === undefined || number <= choice.range.max);
    return <section className="choice-panel" role="dialog" aria-label={choice.prompt}>
      <h3>{choice.prompt}</h3>
      <p>Range: {choice.range.max === undefined ? `${choice.range.min} or more` : `${choice.range.min}–${choice.range.max}`}</p>
      <input aria-label={choice.prompt} type="number" step={1} min={choice.range.min} max={choice.range.max} value={numberText} onChange={event => onNumber?.(event.target.value)} />
      <button data-action="confirm" disabled={!valid} onClick={() => onAnswer({ choiceId: choice.id, number })}>Confirm</button>
      <button onClick={() => onAnswer({ choiceId: choice.id, cancel: true })}>Cancel</button>
    </section>;
  }
  const allocating = choice.kind === 'distribution' || choice.kind === 'payment';
  const total = Object.values(allocations).reduce((sum, amount) => sum + amount, 0);
  const weight = choice.options.reduce((sum, option) => sum + (selected.includes(option.id) ? option.weight ?? 0 : 0), 0);
  const groups = choice.options.flatMap(option =>
    option.distinctGroup !== undefined && selected.includes(option.id) ? [option.distinctGroup] : []);
  const selectedGroups = new Set(groups);
  const valid = allocating ? total === choice.total && Object.entries(allocations).every(([id, amount]) =>
    Number.isSafeInteger(amount) && amount >= 0 && choice.options.some(option => option.id === id && amount <= (option.limit ?? Infinity))) && choice.options.every(option => (allocations[option.id] ?? 0) >= (choice.minimumPerOption ?? 0))
    : selected.length >= choice.min && selected.length <= choice.max && selectedGroups.size === groups.length &&
      (choice.weightGreaterThan === undefined || weight > choice.weightGreaterThan);
  const cardTray = usesCardTray(choice);
  const renderOption = (option: (typeof choice.options)[number]) => {
    const index = selected.indexOf(option.id);
    const order = choice.kind === 'ordering' && index >= 0 ? `${index + 1}. ` : '';
    if (allocating) return <label key={option.id}>{option.label}
      <input aria-label={option.label} type="number" min={choice.minimumPerOption ?? 0} max={option.limit ?? choice.total} step={1} value={allocations[option.id] ?? 0}
        onChange={event => onAllocation(option.id, Number(event.target.value))} />
    </label>;
    const disabled = choice.max > 1 && index < 0 && option.distinctGroup !== undefined && selectedGroups.has(option.distinctGroup);
    if (option.card) return <div className="card-tray-option">
      <MatchCardFace card={option.card} label={option.label} role="button" aria-label={order + option.label}
        aria-pressed={index >= 0} aria-disabled={disabled || undefined}
        onClick={() => { if (!disabled) onSelection(option.id); }} />
      {order && <span className="card-tray-order" aria-hidden="true">{index + 1}</span>}
    </div>;
    return <button key={option.id} type="button" aria-pressed={index >= 0}
      disabled={disabled}
      onClick={() => onSelection(option.id)}>
      {order + option.label}
    </button>;
  };
  return <section className={cardTray ? 'choice-panel card-tray-panel card-choice' : 'choice-panel'} role="dialog" aria-label={choice.prompt}>
    <h3>{choice.prompt}</h3>
    {cardTray && choice.sourceLabel && <p>{choice.sourceLabel}</p>}
    <p>{allocating ? `Allocate ${choice.total} (${total} selected)` : choice.kind === 'ordering' ? 'Select items in the desired order' : `Choose ${choice.min === choice.max ? choice.min : `${choice.min}–${choice.max}`}.`}</p>
    {choice.weightGreaterThan !== undefined && <p aria-live="polite">Selected mana value {weight}. Required above {choice.weightGreaterThan}.</p>}
    {cardTray ? <CardTray label="Cards to choose from" items={choice.options.map(option => ({
      id: option.id, content: renderOption(option),
    }))} /> : <div className="choice-options">{choice.options.map(renderOption)}</div>}
    <button data-action="confirm" disabled={!valid} onClick={() => onAnswer({ choiceId: choice.id, ...(allocating ? { allocations } : { choices: selected }) })}>Confirm</button>
    {choice.cancellable && <button onClick={() => onAnswer({ choiceId: choice.id, cancel: true })}>Cancel</button>}
  </section>;
}

function OwnedChoice({ choice }: { choice: PendingChoice }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [numberText, setNumberText] = useState('');
  const { playerAction } = useGameActions();
  const form = <ChoiceForm choice={choice} selected={selected} allocations={allocations}
    numberText={numberText} onNumber={setNumberText}
    onSelection={id => setSelected(previous => choice.kind === 'number' ? previous : previous.includes(id) ? previous.filter(value => value !== id)
      : choice.max === 1 ? [id] : previous.length < choice.max ? [...previous, id] : previous)}
    onAllocation={(id, amount) => setAllocations(previous => ({ ...previous, [id]: amount }))}
    onAnswer={data => playerAction(ACTION_IDS.choose, undefined, undefined, data)} />;
  if (usesCardTray(choice)) return typeof document === 'undefined' ? form : createPortal(form, document.body);
  return <>{choice.sourceLabel && <p>{choice.sourceLabel}{Object.entries(choice.numericBindings ?? {}).map(([name, number]) => ` · ${name}: ${number}`).join('')}</p>}{form}</>;
}

export default function ChoicePanel() {
  const choice = useGameStore(state => state.room?.pendingChoice);
  const playerId = useGameStore(state => state.myPlayerId);
  if (!choice) return null;
  if (choice.kind === 'waiting' || choice.playerId !== playerId) return <p role="status">Waiting for the other player's choice…</p>;
  return <OwnedChoice key={choice.id} choice={choice} />;
}
