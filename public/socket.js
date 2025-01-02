import { cards } from './library';

const socket = io();
let roomId = sessionStorage.getItem('roomId');

console.log('testing:', cards['rock']);