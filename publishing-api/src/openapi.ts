import { z } from 'zod';
import { jobSchema, publishRequestSchema, publishResponseSchema, tokenRequestSchema, tokenResponseSchema } from '../../shared/schemas.js';

const schema = (value: z.ZodType) => z.toJSONSchema(value, { target: 'openapi-3.0', unrepresentable: 'throw' });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (name: string) => ({ 'application/json': { schema: ref(name) } });
const error = (description: string) => ({ description, content: json('Error') });
const protectedOperation = { security: [{ bearerAuth: [] }] };

export const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'Fineline Publishing API', version: '1.0.0',
    description: 'Publish Source documents asynchronously. Swagger requests create real jobs. Files are limited to 5 MiB. Job and idempotency state last only for this process lifetime.',
  },
  // Resolve relative to the spec URL, supporting both API /docs and frontend /api/docs.
  servers: [{ url: '.' }],
  tags: [{ name: 'Authentication' }, { name: 'Publication' }, { name: 'Health' }],
  paths: {
    '/oauth/token': {
      post: {
        tags: ['Authentication'], operationId: 'issueToken', summary: 'Issue a short-lived bearer token',
        description: 'Form-encoded client credentials. The opaque token expires after 900 seconds. Copy access_token into Authorize; omit the Bearer prefix. This is a minimal client-credentials endpoint, not a full OAuth server.',
        requestBody: { required: true, content: { 'application/x-www-form-urlencoded': { schema: ref('TokenRequest') } } },
        responses: {
          '200': { description: 'Token issued; Cache-Control: no-store.', content: json('TokenResponse') },
          '400': error('Invalid form, unsupported grant type, or invalid credentials shape.'),
          '401': error('Invalid client credentials.'), '413': error('Request body exceeds 4 KiB.'),
        },
      },
    },
    '/publish': {
      post: {
        ...protectedOperation, tags: ['Publication'], operationId: 'publishDocument', summary: 'Submit a document publication',
        description: 'Returns immediately. Matching requestId and documentId return the same job, including after failure. Reusing requestId with a different document is a conflict. A new requestId for any previously submitted document is also a conflict; its existing jobId is returned. No automatic redrive. Unknown Source documents are accepted first and fail asynchronously. New jobs may be rejected at capacity (1000 retained jobs) or when the worker stops accepting work.',
        requestBody: { required: true, content: { 'application/json': { schema: ref('PublishRequest'), example: { documentId: 'DOC001', requestId: 'REQ001' } } } },
        responses: {
          '202': {
            description: 'Accepted or matching duplicate. Poll the returned job.', content: json('PublishResponse'),
            headers: { Location: { description: 'Job path relative to the Publishing API root.', schema: { type: 'string' }, example: '/jobs/123e4567-e89b-42d3-a456-426614174000' } },
          },
          '400': error('Invalid JSON, content type, or document/request ID.'),
          '401': error('Missing, invalid, or expired bearer token. No work created.'),
          '409': {
            description: 'Request ID conflict, or document already submitted. Only the document conflict includes jobId.',
            content: { 'application/json': { schema: ref('Error'), examples: {
              requestConflict: { value: { error: { code: 'REQUEST_ID_CONFLICT', message: 'Request ID belongs to another document.' } } },
              documentConflict: { value: { error: { code: 'DOCUMENT_ALREADY_SUBMITTED', message: 'Document has already been submitted.' }, jobId: '123e4567-e89b-42d3-a456-426614174000' } },
            } } },
          },
          '413': error('Request body exceeds 4 KiB.'), '503': error('New publications cannot be accepted; matching duplicates still resolve.'),
        },
      },
    },
    '/jobs/{id}': {
      get: {
        ...protectedOperation, tags: ['Publication'], operationId: 'getJob', summary: 'Read publication status',
        description: 'running includes queued work and final reporting retries. done means Vendor delivery succeeded and Source acknowledged Published. failed means processing failed and Source acknowledged Error. Final reporting retries indefinitely and retains the worker. vendorAttempts counts delivery requests, including retries. A successful retry ends as done. Cache-Control: no-store.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^[A-Za-z0-9_-]+$', minLength: 1, maxLength: 128 } }],
        responses: {
          '200': { description: 'Current job snapshot.', content: json('Job') },
          '400': error('Invalid job ID.'), '401': error('Missing, invalid, or expired token.'),
          '404': error('Unknown job, including state lost after a process restart.'),
        },
      },
    },
    '/health': {
      get: {
        tags: ['Health'], operationId: 'getHealth', summary: 'Check API worker readiness',
        description: 'Does not probe Source or Vendor connectivity.',
        responses: {
          '200': { description: 'Worker accepts work.', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', enum: ['ok'] } }, required: ['status'] } } } },
          '503': { description: 'Worker unavailable.', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', enum: ['unavailable'] } }, required: ['status'] } } } },
        },
      },
    },
  },
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'opaque' } },
    schemas: {
      PublishRequest: schema(publishRequestSchema), PublishResponse: schema(publishResponseSchema),
      TokenRequest: schema(tokenRequestSchema), TokenResponse: schema(tokenResponseSchema), Job: schema(jobSchema),
      Error: {
        type: 'object', required: ['error'], properties: {
          error: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string' }, message: { type: 'string' } } },
          jobId: { type: 'string', description: 'Present for DOCUMENT_ALREADY_SUBMITTED.' },
        },
      },
    },
  },
};
