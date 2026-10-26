import pino from 'pino';

export type Logger = pino.Logger;

export function createLogger(level = 'info', pretty = process.stdout.isTTY): Logger {
  if (pretty) {
    return pino({
      level,
      transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
    });
  }
  return pino({ level });
}
