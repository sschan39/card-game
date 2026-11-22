import { puppetAttackCases, puppetGraveyardCost } from '../helpers/puppet-card-case';

export default [
  puppetGraveyardCost(3, 1),
  ...puppetAttackCases(1, 0, 'attack-reanimate'),
];
