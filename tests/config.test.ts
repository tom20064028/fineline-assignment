import { describe, expect, it } from 'vitest';
import { readPublisherConfig, readSourceConfig, readVendorConfig } from '../shared/config.js';

describe('Zod configuration', () => {
  const credentials = { CLIENT_ID: 'test-client', CLIENT_SECRET: 'sensitive-config-secret' };
  it('validates and defaults settings for all three services', () => {
    expect(readPublisherConfig(credentials)).toMatchObject({ ...credentials, API_PORT: 3001, ARCHIVE_DIR: './archive', LOG_LEVEL: 'info' });
    expect(readPublisherConfig({ ...credentials, API_PORT: '4321', LOG_LEVEL: 'debug' }).API_PORT).toBe(4321);
    expect(readSourceConfig({})).toEqual({ SOURCE_PORT: 3002, LOG_LEVEL: 'info' });
    expect(readVendorConfig({})).toEqual({ VENDOR_PORT: 3003, VENDOR_FAILURE_RATE: 0.3, LOG_LEVEL: 'info' });
    expect(readVendorConfig({ VENDOR_FAILURE_RATE: '0' }).VENDOR_FAILURE_RATE).toBe(0);
  });

  it.each([
    { API_PORT: '65536' }, { API_PORT: 'not-a-port' }, { LOG_LEVEL: 'not-a-level' },
    { SOURCE_URL: 'ftp://example.com' }, { SOURCE_URL: 'invalid-url' },
    { SOURCE_URL: 'http://name:private-password@example.com' },
    { CLIENT_SECRET: '' },
  ])('rejects invalid configuration without printing values: %j', (values) => {
    expect(() => readPublisherConfig({ ...credentials, ...values })).toThrow('Invalid configuration fields:');
    try { readPublisherConfig({ ...credentials, ...values }); }
    catch (error) {
      expect(String(error)).not.toContain('sensitive-config-secret');
      expect(String(error)).not.toContain('private-password');
    }
  });

  it('requires credentials and validates the Vendor failure rate', () => {
    expect(() => readPublisherConfig({})).toThrow('CLIENT_ID, CLIENT_SECRET');
    expect(() => readVendorConfig({ VENDOR_FAILURE_RATE: '1.1' })).toThrow('VENDOR_FAILURE_RATE');
    expect(() => readVendorConfig({ VENDOR_FAILURE_RATE: 'invalid' })).toThrow('VENDOR_FAILURE_RATE');
  });

  it('validates the documentation switch', () => {
    expect(readPublisherConfig({ ...credentials, API_DOCS_ENABLED: 'false' }).API_DOCS_ENABLED).toBe(false);
    expect(() => readPublisherConfig({ ...credentials, API_DOCS_ENABLED: 'yes' })).toThrow('API_DOCS_ENABLED');
  });
});
