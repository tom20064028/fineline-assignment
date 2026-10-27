import { serve } from '../../shared/runtime.js';
import { readSourceConfig } from '../../shared/config.js';
import { createLogger } from '../../shared/logger.js';
import { createSourceStub, seededDocuments } from './app.js';
import { testingBefore, testingDocuments } from './testing.js';

const config = readSourceConfig();
const logger = createLogger('source-stub', undefined, config.LOG_LEVEL);
serve(createSourceStub({
  logger,
  ...(config.SOURCE_TEST_MODE ? {
    documents: [...seededDocuments(), ...testingDocuments()],
    before: testingBefore(config.SOURCE_TEST_DELAY_MS),
  } : {}),
}).app, config.SOURCE_PORT, 'source-stub', undefined, logger);
