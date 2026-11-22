import { puppetAttackCases, puppetGraveyardCost } from '../helpers/puppet-card-case';

export default [
  puppetGraveyardCost(5, 4),
  ...puppetAttackCases(4, 2, 'attack-mill-reanimate', { mill: true }),
];
