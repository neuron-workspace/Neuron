import { promises as fs } from 'fs';
import * as path from 'path';

export const LOG_FILE_NAME = 'neuron.log';
export const MAX_LOG_BYTES = 1024 * 1024;
export const MAX_LOG_FILES = 3;
export const MAX_MESSAGE_CHARS = 2_000;
export const MAX_STACK_CHARS = 8_000;

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  category: string;
  message: unknown;
  stack?: unknown;
}

export interface SessionInfo {
  appVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  electronVersion: string;
}

const truncate = (value: string, limit: number): string => (
  value.length <= limit ? value : `${value.slice(0, limit)}… [truncated ${value.length - limit} characters]`
);

/** Error messages may contain an MDX source excerpt. Keep the diagnostic, not the note. */
export function redactMessage(value: unknown): string {
  const text = String(value ?? 'Unknown error')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '<style>[content redacted]</style>')
    .replace(/(```|~~~)[\s\S]*?\1/g, '$1[content redacted]$1');
  const newline = text.search(/\r?\n/);
  const singleLine = newline < 0 ? text : `${text.slice(0, newline)} [multiline content redacted]`;
  return truncate(singleLine, MAX_MESSAGE_CHARS);
}

export function redactStack(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return truncate(String(value), MAX_STACK_CHARS);
}

export function formatLogLine(entry: LogEntry, timestamp = new Date().toISOString()): string {
  const stack = redactStack(entry.stack);
  return `${JSON.stringify({
    timestamp,
    level: entry.level,
    category: truncate(String(entry.category), 100),
    message: redactMessage(entry.message),
    ...(stack ? { stack } : {}),
  })}\n`;
}

export function shouldRotate(currentBytes: number, nextLineBytes: number, cap = MAX_LOG_BYTES): boolean {
  return currentBytes > 0 && currentBytes + nextLineBytes > cap;
}

export function rotationPaths(filePath: string, files = MAX_LOG_FILES): Array<[string, string]> {
  const moves: Array<[string, string]> = [];
  for (let suffix = files - 1; suffix >= 1; suffix -= 1) {
    const source = suffix === 1 ? filePath : `${filePath}.${suffix - 1}`;
    moves.push([source, `${filePath}.${suffix}`]);
  }
  return moves;
}

export function createDiagnosticLogger(
  logsDirectory: string,
  options: { maxBytes?: number; files?: number } = {},
) {
  const filePath = path.join(logsDirectory, LOG_FILE_NAME);
  const maxBytes = options.maxBytes ?? MAX_LOG_BYTES;
  const files = options.files ?? MAX_LOG_FILES;
  let queue = Promise.resolve();

  const append = async (line: string): Promise<void> => {
    await fs.mkdir(logsDirectory, { recursive: true });
    let size = 0;
    try { size = (await fs.stat(filePath)).size; } catch { /* new or unreadable log */ }
    if (shouldRotate(size, Buffer.byteLength(line), maxBytes)) {
      for (const [source, destination] of rotationPaths(filePath, files)) {
        try {
          await fs.rm(destination, { force: true });
          await fs.rename(source, destination);
        } catch { /* absent/locked logs are harmless */ }
      }
    }
    await fs.appendFile(filePath, line, 'utf8');
  };

  const write = (entry: LogEntry): Promise<boolean> => {
    const operation = queue.then(() => append(formatLogLine(entry)));
    queue = operation.catch((error) => { console.error('Failed to write diagnostic log:', error); });
    return operation.then(() => true, () => false);
  };

  return {
    filePath,
    directory: logsDirectory,
    write,
    startSession: (info: SessionInfo) => write({
      level: 'info',
      category: 'session',
      message: `Neuron ${info.appVersion}; ${info.platform} ${info.arch}; Electron ${info.electronVersion}`,
    }),
  };
}

export function errorDetails(error: unknown): { message: string; stack?: string } {
  return error instanceof Error
    ? { message: error.message, stack: error.stack }
    : { message: String(error) };
}
