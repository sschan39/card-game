import { createContext, useContext } from 'react';
import socket, { recoverBoard } from './socket';

type MatchConnection = { socket: typeof socket; recover: () => void; playtest?: true };
const multiplayer: MatchConnection = { socket, recover: () => recoverBoard() };
export const MatchConnectionContext = createContext(multiplayer);
export const useMatchConnection = () => useContext(MatchConnectionContext);
