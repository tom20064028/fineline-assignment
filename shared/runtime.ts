import type { Express } from 'express';
import type { Logger } from 'pino';
import { createLogger } from './logger.js';

export function serve(app: Express, listenPort: number, name: string, drain?: () => Promise<void>, logger: Logger = createLogger(name)): void {
  const server = app.listen(listenPort, '0.0.0.0');
  server.on('listening', () => logger.info({ event: 'server_started', port: listenPort }, 'HTTP server listening'));
  server.on('error', () => { logger.error({ event: 'server_error' }, 'HTTP server failed'); process.exitCode = 1; });
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    logger.info({ event: 'server_stopping' }, 'Draining background work');
    const deadline = setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 12_000);
    deadline.unref();
    server.close();
    await drain?.();
    server.closeAllConnections();
    clearTimeout(deadline);
  };
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => { void shutdown().catch(() => { logger.error({ event: 'shutdown_error' }, 'Shutdown failed'); process.exitCode = 1; }); });
  }
}
