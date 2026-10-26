import { randomUUID } from 'node:crypto';
import express from 'express';
import type { Logger } from 'pino';
import type { Delivery } from '../../shared/contracts.js';
import { AppError } from '../../shared/errors.js';
import { baseApp, finishApp } from '../../shared/http.js';
import { decodeFile, hash, id, parse } from '../../shared/validation.js';
import { deliverySchema } from '../../shared/schemas.js';
import { createLogger } from '../../shared/logger.js';

export type VendorOutcome = 'success' | 'accept-disconnect' | number;
export interface VendorOptions {
  logger?: Logger;
  failureRate?: number;
  random?: () => number;
  outcomes?: VendorOutcome[];
  onRequest?: (key: string, delivery: Delivery) => void;
}
export function createVendorStub(options: VendorOptions = {}) {
  const rate = options.failureRate ?? 0.3;
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new Error('VENDOR_FAILURE_RATE must be between 0 and 1.');
  const receipts = new Map<string, { receiptId: string; delivery: Delivery }>();
  const requests: { key: string; delivery: Delivery }[] = [];
  const outcomes = [...(options.outcomes ?? [])];
  const app = baseApp(options.logger ?? createLogger('vendor-stub'));
  app.use(express.json({ limit: '8mb' }));
  app.post('/deliveries', (req, res) => {
    const key = id(req.get('Idempotency-Key'));
    const delivery = parse(deliverySchema, req.body);
    const bytes = decodeFile(delivery.contentBase64);
    const sha256 = hash(bytes);
    if (delivery.sha256 !== sha256) throw new AppError(400, 'HASH_MISMATCH', 'File checksum does not match.');
    requests.push({ key, delivery });
    options.onRequest?.(key, delivery);
    const existing = receipts.get(key);
    if (existing) {
      if (JSON.stringify(existing.delivery) !== JSON.stringify(delivery)) throw new AppError(409, 'DELIVERY_CONFLICT', 'Idempotency key payload conflict.');
      res.json({ receiptId: existing.receiptId });
      return;
    }
    const outcome = outcomes.shift() ?? ((options.random ?? Math.random)() < rate ? 500 : 'success');
    if (typeof outcome === 'number') { res.status(outcome).json({ error: { code: 'VENDOR_REJECTED', message: 'Vendor rejected delivery.' } }); return; }
    const receipt = { receiptId: randomUUID(), delivery };
    receipts.set(key, receipt);
    if (outcome === 'accept-disconnect') { res.destroy(); return; }
    res.json({ receiptId: receipt.receiptId });
  });
  finishApp(app);
  return { app, receipts, requests };
}
