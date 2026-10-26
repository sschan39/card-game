/** UI diagnostics have no dependency on game rules or server configuration. */
function log(level: 'info' | 'warn' | 'error', event: string, message: string, details?: unknown) {
  console[level]('[client:' + event + '] ' + message, details ?? '');
}
export const clientLogger = {
  info: (event: string, message: string, details?: unknown) => log('info', event, message, details),
  warn: (event: string, message: string, details?: unknown) => log('warn', event, message, details),
  error: (event: string, message: string, details?: unknown) => log('error', event, message, details),
};
