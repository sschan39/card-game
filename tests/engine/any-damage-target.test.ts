import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { ActionRegistry, registerAction } from '../../src/engine/action-registry';
import { playCardHandler } from '../../src/engine/handlers/play-card-handler';
import { createTestRoom, fillTestLibraries } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';
import { instantiateCard } from '../../src/library/card-factory';
import { normalizeCard } from '../../src/library/card-parser';
import { targetOptions } from '../../src/engine/choices';
import { structuralTargetLegal } from '../../src/shared/target-legality';
const engines: GameEngine[] = []; let registry: typeof ActionRegistry;
beforeEach(() => { registry = { ...ActionRegistry }; registerAction('cast_spell', playCardHandler); });
afterEach(() => { engines.splice(0).forEach(e => e.dispose()); Object.keys(ActionRegistry).forEach(k => delete ActionRegistry[k]); Object.assign(ActionRegistry, registry); });
function game() {
  const room = createTestRoom(); fillTestLibraries(room); const source=room.players.player1.hand[0];
  source.blueprint = normalizeCard({ id:'any-damage-fixture', name:'Any damage', cardTypes:['Spell'], keywords:['Lifelink'], onCastEffects:[{action:'DEAL_DAMAGE',params:{amount:3},targeting:{type:'any',cardTypes:['Creature'],required:true,maxTargets:1}}] });
  const enemy=creature('enemy','player2',2,8), land=instantiateCard('land-red'); land.state={...land.state,zone:'battlefield',controllerId:'player2',ownerId:'player2'};
  room.battlefield=[enemy,land]; const engine=new GameEngine(room);engine.initRoom(); engines.push(engine); return {engine,source,enemy,land};
}
describe('any player or permanent damage target',()=>{
  it.each(['player','permanent'] as const)('deals one hit to a selected %s through the ordinary damage pipeline',kind=>{
    const {engine,source,enemy}=game();
    const target=kind==='player'?{targetType:'player' as const,playerId:'player2'}:{targetType:'permanent' as const,cardUuid:enemy.uuid};
    expect(engine.executePlayerAction('player1','cast_spell',{cardUuid:source.uuid,targets:[target]}).success).toBe(true);
    expect(engine.roomState.stack[0].targetGroups).toHaveLength(1); engine.resolveTopOfStack();
    expect(engine.roomState.players.player1.life).toBe(23);
    if(kind==='player')expect(engine.roomState.players.player2.life).toBe(17);
    else expect(engine.roomState.battlefield.find(c=>c.uuid===enemy.uuid)?.state.damageTaken).toBe(3);
    const damage=engine.drainEventBatches().flatMap(b=>b.events).filter(e=>e.eventId==='DAMAGE_DEALT'); expect(damage).toHaveLength(1);expect(damage[0].payload.amount).toBe(3);
  });
  it('offers players and battlefield creatures in the same target prompt',()=>{
    const {engine,source,enemy,land}=game(); const def=source.blueprint.onCastEffects![0].targeting;
    const options=targetOptions(engine.roomState,'player1',source,def);
    expect(options.map(o=>o.id)).toContain('player:player1');expect(options.map(o=>o.id)).toContain('player:player2');expect(options.map(o=>o.id)).toContain('permanent:'+enemy.uuid);expect(options.map(o=>o.id)).not.toContain('permanent:'+land.uuid);
    expect(engine.executePlayerAction('player1','cast_spell',{cardUuid:source.uuid}).success).toBe(true);
    const choice=engine.roomState.pendingChoice!;if(choice.kind==='number')throw Error('Expected target prompt');
    expect(choice.options.map(o=>o.id)).toContain('player:player2');expect(choice.options.map(o=>o.id)).toContain('permanent:'+enemy.uuid);
  });
  it('ignores card-type filters for players while rejecting Lands, off-battlefield cards and forged stack pointers',()=>{
    const {engine,source,land}=game(); const def={...source.blueprint.onCastEffects![0].targeting,cardTypes:['Creature']};
    expect(structuralTargetLegal(engine.roomState,'player1',{targetType:'player',playerId:'player2'},def)).toBe(true);
    expect(structuralTargetLegal(engine.roomState,'player1',{targetType:'permanent',cardUuid:land.uuid},def)).toBe(false);
    expect(structuralTargetLegal(engine.roomState,'player1',{targetType:'card',cardUuid:source.uuid},def)).toBe(false);
    expect(structuralTargetLegal(engine.roomState,'player1',{targetType:'stack',stackUuid:'forged'},def)).toBe(false);
    expect(engine.executePlayerAction('player1','cast_spell',{cardUuid:source.uuid,targets:[{targetType:'stack',stackUuid:'forged'}]}).success).toBe(false);
  });
  it('honors card targeting permissions both when choosing and resolving',()=>{
    const {engine,source,enemy}=game(); enemy.blueprint={...enemy.blueprint,keywords:['Hexproof']};
    const def=source.blueprint.onCastEffects![0].targeting;
    expect(targetOptions(engine.roomState,'player1',source,def).some(o=>o.id==='permanent:'+enemy.uuid)).toBe(false);
    enemy.blueprint={...enemy.blueprint,keywords:[]};
    expect(engine.executePlayerAction('player1','cast_spell',{cardUuid:source.uuid,targets:[{targetType:'permanent',cardUuid:enemy.uuid}]}).success).toBe(true);
    enemy.blueprint={...enemy.blueprint,keywords:['Shroud']};engine.resolveTopOfStack();
    expect(engine.roomState.battlefield.find(c=>c.uuid===enemy.uuid)?.state.damageTaken).toBe(0);
    expect(engine.roomState.players.player1.life).toBe(20);
  });
});
