import { z } from 'zod';
import { logLevelSchema } from './schemas.js';

const portSchema = z.coerce.number().int().min(1).max(65535);
const httpUrlSchema = z.string().url().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
});
const sharedConfig = z.object({ LOG_LEVEL: logLevelSchema.default('info') });
const publisherConfig = sharedConfig.extend({
  CLIENT_ID: z.string().min(1).max(255), CLIENT_SECRET: z.string().min(1).max(1024),
  API_PORT: portSchema.default(3001),
  SOURCE_URL: httpUrlSchema.default('http://127.0.0.1:3002'),
  VENDOR_URL: httpUrlSchema.default('http://127.0.0.1:3003'),
  ARCHIVE_DIR: z.string().min(1).default('./archive'),
  API_DOCS_ENABLED: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
});
const sourceConfig = sharedConfig.extend({ SOURCE_PORT: portSchema.default(3002) });
const vendorConfig = sharedConfig.extend({
  VENDOR_PORT: portSchema.default(3003),
  VENDOR_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0.3),
});

function config<T extends z.ZodType>(schema: T, env: NodeJS.ProcessEnv): z.output<T> {
  const result = schema.safeParse(env);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))].join(', ');
    throw new Error(`Invalid configuration fields: ${fields}.`);
  }
  return result.data;
}
export const readPublisherConfig = (env: NodeJS.ProcessEnv = process.env) => config(publisherConfig, env);
export const readSourceConfig = (env: NodeJS.ProcessEnv = process.env) => config(sourceConfig, env);
export const readVendorConfig = (env: NodeJS.ProcessEnv = process.env) => config(vendorConfig, env);
