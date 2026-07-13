"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncService = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class SyncService {
    constructor(io, deltaLogPath) {
        this.sequences = new Map();
        this.io = io;
        this.deltaLogPath = deltaLogPath || null;
    }
    sync(oldState, newState, context) {
        const changes = this.computeDiff(oldState, newState, '');
        const seq = this.nextSeq(newState.roomId);
        const delta = {
            roomId: newState.roomId,
            seq,
            timestamp: Date.now(),
            action: context.action,
            playerId: context.playerId,
            changes,
        };
        // Emit to both players in the room
        this.io.to(newState.roomId).emit('stateDelta', delta);
        // Write to delta log
        if (this.deltaLogPath) {
            this.appendToLog(delta);
        }
    }
    replay(roomId, fromSeq) {
        if (!this.deltaLogPath)
            return [];
        const logFile = path.join(this.deltaLogPath);
        if (!fs.existsSync(logFile))
            return [];
        const lines = fs.readFileSync(logFile, 'utf-8').trim().split('\n').filter(Boolean);
        const deltas = [];
        for (const line of lines) {
            try {
                const delta = JSON.parse(line);
                if (delta.roomId === roomId) {
                    if (fromSeq === undefined || delta.seq >= fromSeq) {
                        deltas.push(delta);
                    }
                }
            }
            catch {
                // Skip malformed lines
            }
        }
        return deltas;
    }
    nextSeq(roomId) {
        const current = this.sequences.get(roomId) || 0;
        const next = current + 1;
        this.sequences.set(roomId, next);
        return next;
    }
    computeDiff(oldState, newState, basePath) {
        const changes = [];
        if (oldState === newState)
            return changes;
        if (Array.isArray(oldState) && Array.isArray(newState)) {
            if (oldState.length !== newState.length) {
                if (newState.length > oldState.length) {
                    for (let i = oldState.length; i < newState.length; i++) {
                        changes.push({
                            path: basePath,
                            op: 'add',
                            value: newState[i],
                        });
                    }
                }
                else {
                    for (let i = newState.length; i < oldState.length; i++) {
                        changes.push({
                            path: basePath,
                            op: 'remove',
                            value: oldState[i],
                        });
                    }
                }
            }
            const minLen = Math.min(oldState.length, newState.length);
            for (let i = 0; i < minLen; i++) {
                changes.push(...this.computeDiff(oldState[i], newState[i], `${basePath}[${i}]`));
            }
        }
        else if (typeof oldState === 'object' && typeof newState === 'object' && oldState !== null && newState !== null) {
            const oldObj = oldState;
            const newObj = newState;
            const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
            for (const key of allKeys) {
                const childPath = basePath ? `${basePath}.${key}` : key;
                if (!(key in newObj) || newObj[key] === undefined) {
                    if (key in oldObj && oldObj[key] !== undefined) {
                        changes.push({ path: childPath, op: 'remove', oldValue: oldObj[key] });
                    }
                }
                else if (!(key in oldObj) || oldObj[key] === undefined) {
                    if (newObj[key] !== undefined) {
                        changes.push({ path: childPath, op: 'add', value: newObj[key] });
                    }
                }
                else if (typeof oldObj[key] !== 'object' || oldObj[key] === null) {
                    if (oldObj[key] !== newObj[key]) {
                        changes.push({ path: childPath, op: 'update', value: newObj[key], oldValue: oldObj[key] });
                    }
                }
                else {
                    changes.push(...this.computeDiff(oldObj[key], newObj[key], childPath));
                }
            }
        }
        return changes;
    }
    appendToLog(delta) {
        if (!this.deltaLogPath)
            return;
        const dir = path.dirname(this.deltaLogPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.appendFileSync(this.deltaLogPath, JSON.stringify(delta) + '\n');
    }
}
exports.SyncService = SyncService;
//# sourceMappingURL=sync-service.js.map