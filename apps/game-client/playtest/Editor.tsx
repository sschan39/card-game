import { useEffect, useId, useRef, useState } from 'react';
import { CatalogResponseSchema, filterCatalog, PHASE_LABELS, PLAYTEST_PHASES, PlaytestRecipeSchema, type CatalogCard, type PlaytestCommand, type PlaytestEdit, type PlaytestRecipe, type PlaytestState, type PlaytestZone } from '@card-game/protocol';

const zones = { hand: 'Hand', battlefield: 'Battlefield', graveyard: 'Graveyard', exile: 'Exile', libraryTop: 'Top of library', libraryBottom: 'Bottom of library', hosted: 'Hosted under a permanent' } satisfies Record<PlaytestZone, string>;
const seatLabel = (seat: 0 | 1) => seat === 0 ? 'Seat A' : 'Seat B';
const colorLabels = { white: 'Cold (white)', blue: 'Blue', black: 'Black', red: 'Red', green: 'Green', yellow: 'Yellow' } as const;
type Inputs = PlaytestState['cards'][number];

function useCatalog() {
  const [cards, setCards] = useState<CatalogCard[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const entries: CatalogCard[] = [];
      for (;;) {
        const response = await fetch(`/api/cards?limit=100&offset=${entries.length}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Could not load the card catalog.');
        const result = CatalogResponseSchema.parse(await response.json());
        entries.push(...result.cards);
        if (entries.length >= result.total) break;
        if (!result.cards.length) throw new Error('The card catalog returned an incomplete page.');
      }
      if (!controller.signal.aborted) setCards(entries);
    })().catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Could not load the card catalog.'); });
    return () => controller.abort();
  }, []);
  return { cards, error };
}

export default function Editor({ state, busy, onApply, onUndo, onReset, onCommand, onRecipe }: {
  state: PlaytestState;
  busy: boolean;
  onApply: (edit: PlaytestEdit) => void;
  onUndo: () => void;
  onReset: () => void;
  onCommand: (command: PlaytestCommand) => void;
  onRecipe: (recipe: PlaytestRecipe) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const [mode, setMode] = useState<'add' | 'move' | 'remove' | 'player' | 'permanent' | 'turn' | 'token' | 'attach' | 'modifier' | 'stageSpell' | 'stageAbility'>('add');
  const [query, setQuery] = useState('');
  const [catalogId, setCatalogId] = useState('');
  const [instanceId, setInstanceId] = useState('');
  const [seat, setSeat] = useState<0 | 1>(0);
  const [zone, setZone] = useState<PlaytestZone>('hand');
  const [hostId, setHostId] = useState('');
  const [hostVisibility, setHostVisibility] = useState<'hidden' | 'owner' | 'public'>('hidden');
  const [quantity, setQuantity] = useState(1);
  const { cards, error } = useCatalog();
  useEffect(() => { heading.current?.focus(); }, []);
  const matches = filterCatalog(cards, { search: query, type: '', color: '', legalOnly: false });
  const catalogCard = matches.find(card => card.id === catalogId);
  const instances = state.cards.filter(card => {
    if (mode === 'attach') return card.equipment;
    if (mode === 'stageAbility') return card.activatedAbilities.length > 0;
    if (mode === 'permanent' || mode === 'modifier') return card.zone === 'battlefield';
    return card.zone !== 'stack';
  });
  const instance = instances.find(card => card.uuid === instanceId);
  const hosts = state.cards.filter(card => card.zone === 'battlefield' && card.uuid !== instanceId);
  const host = zone === 'hosted' ? hosts.find(card => card.uuid === hostId) : undefined;
  const useCatalogCard = mode === 'add' || mode === 'stageSpell';
  const place = useCatalogCard || mode === 'move';
  const destination = <label>Destination<select value={zone} onChange={event => setZone(event.target.value as PlaytestZone)}>
    {Object.entries(zones).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
  </select></label>;
  const instancePicker = <label>{mode === 'attach' ? 'Equipment' : mode === 'permanent' || mode === 'modifier' ? 'Battlefield card' : 'Card in the room'}<select value={instance?.uuid ?? ''} onChange={event => setInstanceId(event.target.value)}>
    <option value="">Choose a card</option>
    {instances.map((card, index) => <option key={card.uuid} value={card.uuid}>{card.name} · {seatLabel(card.seat)} · {card.zone} · {index + 1}</option>)}
  </select></label>;
  return <section className="playtest-editor" aria-labelledby={headingId}>
    <h2 id={headingId} ref={heading} tabIndex={-1}>Edit board</h2>
    <p>Play is paused. Setup edits take effect immediately and do not fire card abilities.</p>
    <div className="playtest-edit-toolbar">
      <label>What to edit<select value={mode} onChange={event => { setMode(event.target.value as typeof mode); setInstanceId(''); }}>
        <option value="add">Add from catalog</option><option value="move">Move existing card</option><option value="remove">Remove existing card</option><option value="player">Life and mana</option><option value="permanent">Battlefield card state</option>
        <option value="turn">Turn, phase and priority</option><option value="token">Add a token</option><option value="attach">Attach or detach Equipment</option>
        <option value="modifier">Modify power and toughness</option><option value="stageSpell">Stage a spell on the stack</option>
        <option value="stageAbility">Stage an activated ability</option>
      </select></label>
      {(place || mode === 'player' || mode === 'token') && <SeatPicker label="Player" value={seat} onChange={setSeat} />}
    </div>
    {place && <form onSubmit={event => {
      event.preventDefault();
      if (mode === 'stageSpell') {
        if (catalogCard) onApply({ kind: 'stageSpell', cardId: catalogCard.id, seat });
        return;
      }
      if (zone === 'hosted' && !host) return;
      const target = { seat, zone, ...(host ? { host: { cardUuid: host.uuid, zoneRevision: host.zoneRevision, visibility: hostVisibility } } : {}) };
      if (mode === 'add' && catalogCard) onApply({ kind: 'add', cardId: catalogCard.id, quantity, ...target });
      if (mode === 'move' && instance) onApply({ kind: 'move', cardUuid: instance.uuid, zoneRevision: instance.zoneRevision, ...target });
    }}>
      <fieldset className="playtest-edit-fields" disabled={busy}>
        {useCatalogCard ? <>
          <label>Search card catalog<input type="search" value={query} onChange={event => { setQuery(event.target.value); setCatalogId(''); }} /></label>
          {error ? <p role="alert">{error}</p> : <p role="status">{cards.length ? `${matches.length} ${matches.length === 1 ? 'card' : 'cards'} found` : 'Loading card catalog…'}</p>}
          <label>Catalog card<select required value={catalogCard?.id ?? ''} onChange={event => setCatalogId(event.target.value)}>
            <option value="">Choose a card</option>{matches.map(card => <option key={card.id} value={card.id}>{card.name} · {card.id}</option>)}
          </select></label>
          {mode === 'add' && <label>Copies<input type="number" min={1} max={20} required value={quantity || ''} onChange={event => setQuantity(Number(event.target.value))} /></label>}
        </> : instancePicker}
        {mode !== 'stageSpell' && destination}
        {mode !== 'stageSpell' && zone === 'hosted' && <>
          <label>Host permanent<select required value={host?.uuid ?? ''} onChange={event => setHostId(event.target.value)}><option value="">Choose a host</option>{hosts.map((value, index) => <option key={value.uuid} value={value.uuid}>{value.name} · {seatLabel(value.seat)} · {index + 1}</option>)}</select></label>
          <label>Hosted card visibility<select value={hostVisibility} onChange={event => setHostVisibility(event.target.value as typeof hostVisibility)}><option value="hidden">Hidden</option><option value="owner">Owner only</option><option value="public">Both seats</option></select></label>
        </>}
        {catalogCard && useCatalogCard && <p className="playtest-edit-description">{catalogCard.rulesText}</p>}
        {mode === 'stageSpell' && <p>Prepare a spell without paying its cost. Use normal play or a JSON recipe for spells that require targets or choices.</p>}
        <button type="submit" disabled={(useCatalogCard ? !catalogCard : !instance) || mode !== 'stageSpell' && zone === 'hosted' && !host}>
          {mode === 'stageSpell' ? 'Stage spell' : mode === 'add' ? 'Add card' : 'Move card'}
        </button>
      </fieldset>
    </form>}
    {mode === 'player' && <PlayerEditor key={`${seat}:${state.revision}`} seat={seat} state={state.players[seat]} busy={busy} onApply={onApply} />}
    {mode === 'permanent' && <>{instancePicker}{instance && <PermanentEditor key={`${instance.uuid}:${state.revision}`} card={instance} busy={busy} onApply={onApply} />}</>}
    {mode === 'turn' && <TurnEditor key={state.revision} turn={state.turn} busy={busy} onApply={onApply} />}
    {mode === 'token' && <TokenEditor tokens={state.tokens} seat={seat} busy={busy} onApply={onApply} />}
    {mode === 'attach' && <>{instancePicker}{instance && <AttachmentEditor key={instance.uuid} card={instance} cards={state.cards} busy={busy} onApply={onApply} />}</>}
    {mode === 'modifier' && <>{instancePicker}{instance && <ModifierEditor key={instance.uuid} card={instance} busy={busy} onApply={onApply} />}</>}
    {mode === 'stageAbility' && <>{instancePicker}{instance && <AbilityEditor key={instance.uuid} card={instance} busy={busy} onApply={onApply} />}</>}
    {mode === 'remove' && <form onSubmit={event => {
      event.preventDefault();
      if (instance) onApply({ kind: 'remove', cardUuid: instance.uuid, zoneRevision: instance.zoneRevision });
    }}><fieldset className="playtest-edit-fields" disabled={busy}>{instancePicker}<button type="submit" disabled={!instance}>Remove card</button></fieldset></form>}
    <div className="playtest-edit-toolbar">
      <button type="button" disabled={busy || !state.canUndo} onClick={onUndo}>Undo last edit</button>
      <button type="button" disabled={busy} onClick={onReset}>Reset to starting scenario</button>
    </div>
    <CheckpointEditor state={state} busy={busy} onCommand={onCommand} />
    <RecipeEditor state={state} busy={busy} onApply={onRecipe} />
    {state.history.length > 0 && <details><summary>Edit history</summary><ol>{state.history.map((entry, index) => <li key={index}>{entry}</li>)}</ol></details>}
  </section>;
}

function RecipeEditor({ state, busy, onApply }: { state: PlaytestState; busy: boolean; onApply: (recipe: PlaytestRecipe) => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const example: PlaytestRecipe = { format: 'card-game-playtest-edits', version: 1, edits: [
    { kind: 'add', cardId: 'frozen-snowball', seat: 0, zone: 'hand', quantity: 1 },
    { kind: 'add', cardId: 'frost-messenger', seat: 1, zone: 'libraryTop', quantity: 1 },
  ] };
  return <details><summary>Board edits as JSON</summary>
    <p>Copy a recipe to share it. All edits in a recipe apply together, and one undo restores the previous board.</p>
    <details><summary>IDs for this position</summary>
      <ul>{state.players.map((player, seat) => <li key={player.id}>{seatLabel(seat === 0 ? 0 : 1)} <code>{player.id}</code></li>)}
        {state.stack.map(object => <li key={object.uuid}>{object.name} on the stack <code>{object.uuid}</code></li>)}
        {state.cards.map(card => <li key={card.uuid}>{card.name} in {card.zone} <code>{card.uuid}</code>, revision {card.zoneRevision}</li>)}</ul>
    </details>
    <form onSubmit={event => {
      event.preventDefault();
      try { onApply(PlaytestRecipeSchema.parse(JSON.parse(text))); setError(''); }
      catch { setError('Enter a valid version 1 playtest recipe. Load the example for the format.'); }
    }}>
      <label>Edit recipe<textarea rows={8} maxLength={12000} value={text} onChange={event => { setText(event.target.value); setError(''); }} /></label>
      {error && <p role="alert">{error}</p>}
      <div className="playtest-edit-toolbar"><button type="button" disabled={busy} onClick={() => { setText(JSON.stringify(example, null, 2)); setError(''); }}>Load example</button>
        <button type="submit" disabled={busy || !text.trim()}>Apply recipe</button></div>
    </form>
  </details>;
}

function SeatPicker({ label, value, onChange }: { label: string; value: 0 | 1; onChange: (seat: 0 | 1) => void }) {
  return <label>{label}<select value={value} onChange={event => onChange(event.target.value === '0' ? 0 : 1)}><option value={0}>Seat A</option><option value={1}>Seat B</option></select></label>;
}

function TurnEditor({ turn, busy, onApply }: { turn: PlaytestState['turn']; busy: boolean; onApply: (edit: PlaytestEdit) => void }) {
  const [seat, setSeat] = useState(turn.seat);
  const [priority, setPriority] = useState(turn.priority ?? turn.seat);
  const [turnNumber, setTurnNumber] = useState(turn.number);
  type Phase = typeof PLAYTEST_PHASES[number];
  const [phase, setPhase] = useState<Phase>(PLAYTEST_PHASES.find(value => value === turn.phase) ?? 'stateMainPhase');
  return <form onSubmit={event => { event.preventDefault(); onApply({ kind: 'turn', seat, priority, turnNumber, phase }); }}>
    <fieldset className="playtest-edit-fields" disabled={busy}>
      <legend>Stage a turn position</legend>
      <SeatPicker label="Active player" value={seat} onChange={setSeat} />
      <label>Turn number<input type="number" min={1} max={100000} required value={turnNumber} onChange={event => setTurnNumber(Number(event.target.value))} /></label>
      <label>Phase<select value={phase} onChange={event => setPhase(event.target.value as Phase)}>{PLAYTEST_PHASES.map(value => <option key={value} value={value}>{PHASE_LABELS[value]}</option>)}</select></label>
      {phase !== 'declareAttackersStep' && <SeatPicker label="Priority" value={priority} onChange={setPriority} />}
      <button type="submit">Set turn position</button>
    </fieldset>
  </form>;
}

function TokenEditor({ tokens, seat, busy, onApply }: { tokens: PlaytestState['tokens']; seat: 0 | 1; busy: boolean; onApply: (edit: PlaytestEdit) => void }) {
  const [cardId, setCardId] = useState('');
  const [quantity, setQuantity] = useState(1);
  return <form onSubmit={event => { event.preventDefault(); if (cardId) onApply({ kind: 'token', cardId, seat, quantity }); }}>
    <fieldset className="playtest-edit-fields" disabled={busy}>
      <legend>Place a token on the battlefield</legend>
      <label>Token<select required value={cardId} onChange={event => setCardId(event.target.value)}><option value="">Choose a token</option>{tokens.map(token => <option key={token.cardId} value={token.cardId}>{token.name} · {token.cardId}</option>)}</select></label>
      <label>Copies<input type="number" min={1} max={20} required value={quantity || ''} onChange={event => setQuantity(Number(event.target.value))} /></label>
      <button type="submit" disabled={!cardId}>Place token</button>
    </fieldset>
  </form>;
}

function AttachmentEditor({ card, cards, busy, onApply }: { card: Inputs; cards: Inputs[]; busy: boolean; onApply: (edit: PlaytestEdit) => void }) {
  const [hostId, setHostId] = useState('');
  const hosts = cards.filter(value => value.zone === 'battlefield' && value.uuid !== card.uuid);
  const host = hosts.find(value => value.uuid === hostId);
  return <form onSubmit={event => { event.preventDefault(); onApply({ kind: 'attach', cardUuid: card.uuid, zoneRevision: card.zoneRevision, hostUuid: host?.uuid ?? null, hostRevision: host?.zoneRevision ?? 0 }); }}>
    <fieldset className="playtest-edit-fields" disabled={busy}>
      <legend>Attachment</legend>
      <label>Attach to<select value={host?.uuid ?? ''} onChange={event => setHostId(event.target.value)}><option value="">Detach</option>{hosts.map((value, index) => <option key={value.uuid} value={value.uuid}>{value.name} · {seatLabel(value.seat)} · {index + 1}</option>)}</select></label>
      <button type="submit">{host ? 'Attach Equipment' : 'Detach Equipment'}</button>
    </fieldset>
  </form>;
}

function ModifierEditor({ card, busy, onApply }: { card: Inputs; busy: boolean; onApply: (edit: PlaytestEdit) => void }) {
  const [power, setPower] = useState(0);
  const [toughness, setToughness] = useState(0);
  const [duration, setDuration] = useState<'END_OF_TURN' | 'WHILE_ON_BATTLEFIELD'>('END_OF_TURN');
  return <form onSubmit={event => { event.preventDefault(); onApply({ kind: 'modifier', cardUuid: card.uuid, zoneRevision: card.zoneRevision, power, toughness, duration }); }}>
    <fieldset className="playtest-edit-fields" disabled={busy}>
      <legend>Power and toughness adjustment</legend>
      <label>Power change<input type="number" min={-1000} max={1000} required value={power} onChange={event => setPower(Number(event.target.value))} /></label>
      <label>Toughness change<input type="number" min={-1000} max={1000} required value={toughness} onChange={event => setToughness(Number(event.target.value))} /></label>
      <label>Lasts<select value={duration} onChange={event => setDuration(event.target.value as typeof duration)}><option value="END_OF_TURN">Until end of turn</option><option value="WHILE_ON_BATTLEFIELD">While on the battlefield</option></select></label>
      <button type="submit" disabled={!power && !toughness}>Apply modifier</button>
    </fieldset>
  </form>;
}

function AbilityEditor({ card, busy, onApply }: { card: Inputs; busy: boolean; onApply: (edit: PlaytestEdit) => void }) {
  const [abilityId, setAbilityId] = useState('');
  return <form onSubmit={event => { event.preventDefault(); if (abilityId) onApply({ kind: 'stageAbility', cardUuid: card.uuid, zoneRevision: card.zoneRevision, abilityId }); }}>
    <fieldset className="playtest-edit-fields" disabled={busy}>
      <legend>Prepare an ability without paying its cost</legend>
      <label>Ability<select required value={abilityId} onChange={event => setAbilityId(event.target.value)}>
        <option value="">Choose an ability</option>{card.activatedAbilities.map(id => <option key={id}>{id}</option>)}
      </select></label>
      <button type="submit" disabled={!abilityId}>Stage ability</button>
    </fieldset>
  </form>;
}

function CheckpointEditor({ state, busy, onCommand }: { state: PlaytestState; busy: boolean; onCommand: (command: PlaytestCommand) => void }) {
  const [name, setName] = useState('');
  const [saved, setSaved] = useState('');
  return <details><summary>Named checkpoints</summary>
    <p>Save the exact position, including the stack, combat or a pending choice, and return to it later in this run.</p>
    <form className="playtest-edit-toolbar" onSubmit={event => { event.preventDefault(); if (name.trim()) onCommand({ kind: 'saveCheckpoint', name }); }}>
      <label>Checkpoint name<input required maxLength={60} value={name} onChange={event => setName(event.target.value)} /></label>
      <button type="submit" disabled={busy || !name.trim()}>Save checkpoint</button>
    </form>
    {state.checkpoints.length > 0 && <form className="playtest-edit-toolbar" onSubmit={event => { event.preventDefault(); if (saved) onCommand({ kind: 'restoreCheckpoint', name: saved }); }}>
      <label>Saved checkpoint<select required value={saved} onChange={event => setSaved(event.target.value)}><option value="">Choose a checkpoint</option>{state.checkpoints.map(value => <option key={value}>{value}</option>)}</select></label>
      <button type="submit" disabled={busy || !saved}>Restore checkpoint</button>
    </form>}
  </details>;
}

function PlayerEditor({ seat, state, busy, onApply }: { seat: 0 | 1; state: PlaytestState['players'][number]; busy: boolean; onApply: (edit: PlaytestEdit) => void }) {
  const [life, setLife] = useState(state.life);
  const [mana, setMana] = useState(state.mana);
  const [landPlaysUsed, setLandPlaysUsed] = useState(state.landPlaysUsed);
  return <form onSubmit={event => { event.preventDefault(); onApply({ kind: 'player', seat, life, mana, landPlaysUsed }); }}>
    <fieldset className="playtest-edit-fields" disabled={busy}>
      <legend>{seatLabel(seat)} resources</legend>
      <label>Life<input type="number" min={1} max={1000} required value={life} onChange={event => setLife(Number(event.target.value))} /></label>
      <label>Land plays used<input type="number" min={0} max={1000} required value={landPlaysUsed} onChange={event => setLandPlaysUsed(Number(event.target.value))} /></label>
      {(Object.keys(colorLabels) as (keyof typeof colorLabels)[]).map(color => <label key={color}>{colorLabels[color]} mana<input type="number" min={0} max={1000} required value={mana[color]} onChange={event => setMana({ ...mana, [color]: Number(event.target.value) })} /></label>)}
      <button type="submit">Apply life and mana</button>
    </fieldset>
  </form>;
}

function PermanentEditor({ card, busy, onApply }: { card: Inputs; busy: boolean; onApply: (edit: PlaytestEdit) => void }) {
  const [tapped, setTapped] = useState(card.tapped);
  const [summoningSickness, setSummoningSickness] = useState(card.summoningSickness);
  const [damage, setDamage] = useState(card.damage);
  const [counter, setCounter] = useState({ name: '', amount: 0 });
  return <form onSubmit={event => { event.preventDefault(); onApply({ kind: 'permanent', cardUuid: card.uuid, zoneRevision: card.zoneRevision,
    tapped, summoningSickness, damage, ...(counter.name ? { counter } : {}) }); }}>
    <fieldset className="playtest-edit-fields" disabled={busy}>
      <legend>{card.name}</legend>
      <label><input type="checkbox" checked={tapped} onChange={event => setTapped(event.target.checked)} /> Tapped</label>
      <label><input type="checkbox" checked={summoningSickness} onChange={event => setSummoningSickness(event.target.checked)} /> Summoning sickness</label>
      <label>Marked damage<input type="number" min={0} max={1000} required value={damage} onChange={event => setDamage(Number(event.target.value))} /></label>
      <label>Counter name<input value={counter.name} maxLength={40} pattern="[A-Za-z][A-Za-z0-9_+\-]{0,39}" onChange={event => {
        const name = event.target.value;
        const amount = Object.prototype.hasOwnProperty.call(card.counters, name) ? card.counters[name] : 0;
        setCounter({ name, amount });
      }} /></label>
      <label>Counter count<input type="number" min={0} max={1000} required value={counter.amount} onChange={event => setCounter({ ...counter, amount: Number(event.target.value) })} /></label>
      <button type="submit">Apply card state</button>
    </fieldset>
  </form>;
}
