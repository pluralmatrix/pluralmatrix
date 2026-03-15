import { EventEmitter } from 'events';

export const systemEvents = new EventEmitter();

export const emitSystemUpdate = (mxid: string) => {
  systemEvents.emit('update', mxid);
};
