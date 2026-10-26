import { serve } from '../../shared/runtime.js';
import { readVendorConfig } from '../../shared/config.js';
import { createLogger } from '../../shared/logger.js';
import { createVendorStub } from './app.js';

const config = readVendorConfig();
const logger = createLogger('vendor-stub', undefined, config.LOG_LEVEL);
serve(createVendorStub({ failureRate: config.VENDOR_FAILURE_RATE, logger }).app, config.VENDOR_PORT, 'vendor-stub', undefined, logger);
