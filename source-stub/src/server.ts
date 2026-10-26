import { serve } from '../../shared/runtime.js';
import { readSourceConfig } from '../../shared/config.js';
import { createLogger } from '../../shared/logger.js';
import { createSourceStub } from './app.js';

const config = readSourceConfig();
const logger = createLogger('source-stub', undefined, config.LOG_LEVEL);
serve(createSourceStub({ logger }).app, config.SOURCE_PORT, 'source-stub', undefined, logger);
