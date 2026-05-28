/**
 * Minimal structured logger that produces the same output format as NestJS
 * Logger — used in the standalone BullMQ worker which does not run inside a
 * NestJS application context.
 *
 * Format (matches NestJS default):
 *   [Nest] PID  TIMESTAMP  LOG [Context] message
 */

const pid = process.pid;

function ts(): string {
  return new Date().toLocaleString('en-US', {
    month:  '2-digit',
    day:    '2-digit',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

export class Logger {
  constructor(private readonly context: string) {}

  log(message: string):   void { this.write('LOG',   message); }
  warn(message: string):  void { this.write('WARN',  message); }
  error(message: string): void { this.write('ERROR', message); }
  fatal(message: string): void { this.write('FATAL', message); }

  private write(level: string, message: string): void {
    const line = `[Nest] ${pid}  ${ts()}  ${level.padEnd(5)} [${this.context}] ${message}`;
    if (level === 'ERROR' || level === 'FATAL') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  }
}
