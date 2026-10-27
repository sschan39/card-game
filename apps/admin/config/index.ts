import values from './ui.json';
if (!Number.isInteger(values.pageSize) || values.pageSize < 1 || values.pageSize > 100 || !Number.isInteger(values.roomPollMs) || values.roomPollMs < 1000 || values.roomPollMs > 60000 || values.storageKey !== 'cardgame.adminSession.v1')
  throw new Error('Invalid administrator interface configuration');
export const adminUi = Object.freeze(values);
