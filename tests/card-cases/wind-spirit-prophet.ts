import { entryReveal } from '../helpers/reveal-card-case';

export default [entryReveal({ cardTypes: ['Artifact'], name: '風靈遺跡' }, { green: 2 }, {
  excluded: { name: '風靈先知' }, top: { name: 'Other', subTypes: ['風靈'] },
})];
