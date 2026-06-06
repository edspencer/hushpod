type Level = 'debug' | 'info' | 'warn' | 'error'

function emit(level: Level, scope: string, msg: string, extra?: unknown) {
  const ts = new Date().toISOString()
  const line = `${ts} [${level.toUpperCase()}] (${scope}) ${msg}`
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  if (extra !== undefined) fn(line, extra)
  else fn(line)
}

/** Create a scoped logger, e.g. `const log = logger('processor')`. */
export function logger(scope: string) {
  return {
    debug: (msg: string, extra?: unknown) => emit('debug', scope, msg, extra),
    info: (msg: string, extra?: unknown) => emit('info', scope, msg, extra),
    warn: (msg: string, extra?: unknown) => emit('warn', scope, msg, extra),
    error: (msg: string, extra?: unknown) => emit('error', scope, msg, extra),
  }
}

export type Logger = ReturnType<typeof logger>
