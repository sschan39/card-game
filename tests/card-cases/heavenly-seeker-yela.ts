import { entryReveal } from '../helpers/reveal-card-case';

export default [
  entryReveal({ subTypes: ['上使'] }, { yellow: 2 }, {
    excluded: { name: '天域尋索者 耶拉*', subTypes: ['上使'] },
    top: { cardTypes: ['Artifact'], subTypes: ['Equipment'], colors: ['yellow'] },
    name: 'reveals an Angel creature but excludes its own printed name and yellow equipment',
  }),
  entryReveal({ cardTypes: ['Artifact'], colors: ['yellow'] }, { yellow: 2 }, {
    excluded: { cardTypes: ['Artifact'], colors: ['blue'] },
    top: { cardTypes: ['Land'], colors: ['yellow'] },
    name: 'can take a yellow relic but excludes a blue relic and a yellow land',
  }),
];
