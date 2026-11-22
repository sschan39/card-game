import { entryReveal } from '../helpers/reveal-card-case';

export default [entryReveal({ subTypes: ['炎獸'] }, { red: 2 }, {
  excluded: { name: '赤狼', subTypes: ['炎獸'] }, optional: true,
})];
