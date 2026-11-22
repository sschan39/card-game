import { entryReveal } from '../helpers/reveal-card-case';

export default [entryReveal({ cardTypes: ['Land'], colors: ['yellow'] }, { yellow: 2 }, {
  excluded: { cardTypes: ['Land'], colors: ['blue'] }, top: { cardTypes: ['Creature'], colors: ['yellow'] },
})];
