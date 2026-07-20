"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActionRegistry = void 0;
exports.registerAction = registerAction;
// ============================================================================
// 3. Registry
// ============================================================================
exports.ActionRegistry = {};
function registerAction(type, handler) {
    exports.ActionRegistry[type] = handler;
}
