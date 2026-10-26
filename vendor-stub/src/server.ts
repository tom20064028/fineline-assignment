import { port, serve } from '../../shared/runtime.js';
import { createVendorStub } from './app.js';

const rate = process.env.VENDOR_FAILURE_RATE === undefined ? 0.3 : Number(process.env.VENDOR_FAILURE_RATE);
serve(createVendorStub({ failureRate: rate }).app, port(process.env.VENDOR_PORT, 3003), 'Vendor stub');
