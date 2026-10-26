import type { Express } from 'express';

export function port(value: string | undefined, fallback: number): number {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(result) || result < 1 || result > 65535) throw new Error('Invalid port configuration.');
  return result;
}

export function serve(app: Express, listenPort: number, name: string, drain?: () => Promise<void>): void {
  const server = app.listen(listenPort, '0.0.0.0');
  server.on('listening', () => console.info(`${name} listening on ${listenPort}`));
  server.on('error', (error) => { console.error(error); process.exitCode = 1; });
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 12_000);
    deadline.unref();
    server.close();
    await drain?.();
    server.closeAllConnections();
    clearTimeout(deadline);
  };
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => { void shutdown().catch((error: unknown) => { console.error(error); process.exitCode = 1; }); });
  }
}
