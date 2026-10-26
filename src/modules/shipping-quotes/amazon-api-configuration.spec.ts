import { afterEach, describe, expect, it, vi } from 'vitest';
import { AmazonShippingAdapter } from './amazon-quote.adapter.js';

const sdk = vi.hoisted(() => ({
  auth: vi.fn(),
  client: vi.fn(),
  getAccessToken: vi.fn(async () => 'fixture-access-token'),
}));

vi.mock('@sp-api-sdk/auth', () => ({
  SellingPartnerApiAuth: class {
    constructor(credentials: unknown) {
      sdk.auth(credentials);
    }

    getAccessToken = sdk.getAccessToken;
  },
}));

vi.mock('@sp-api-sdk/shipping-api-v2', () => ({
  ChannelType: { External: 'EXTERNAL' },
  GetRatesXAmznShippingBusinessIdEnum: {
    AmazonShippingUs: 'AmazonShipping_US',
  },
  ShippingApiClient: class {
    constructor(options: unknown) {
      sdk.client(options);
    }
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('Amazon production configuration', () => {
  it('uses neutral credentials and the North America production endpoint', async () => {
    vi.stubEnv('AMAZON_SP_API_CLIENT_ID', 'fixture-client');
    vi.stubEnv('AMAZON_SP_API_CLIENT_SECRET', 'fixture-secret');
    vi.stubEnv('AMAZON_SP_API_REFRESH_TOKEN', 'fixture-refresh');
    const adapter = new AmazonShippingAdapter();

    await adapter.readiness('api');

    expect(sdk.auth).toHaveBeenCalledWith({
      clientId: 'fixture-client',
      clientSecret: 'fixture-secret',
      refreshToken: 'fixture-refresh',
    });
    expect(sdk.client).toHaveBeenCalledWith(
      expect.objectContaining({ region: 'na', sandbox: false }),
    );
    expect(sdk.getAccessToken).toHaveBeenCalledOnce();
    expect(adapter.simulated).toBe(false);
  });

  it('fails closed when production credentials are missing', async () => {
    vi.stubEnv('AMAZON_SP_API_CLIENT_ID', '');
    vi.stubEnv('AMAZON_SP_API_CLIENT_SECRET', '');
    vi.stubEnv('AMAZON_SP_API_REFRESH_TOKEN', '');
    vi.stubEnv('AMAZON_SP_API_SANDBOX_CLIENT_ID', 'old-sandbox-client');

    await expect(
      new AmazonShippingAdapter().readiness('api'),
    ).rejects.toThrow();

    expect(sdk.client).not.toHaveBeenCalled();
  });
});
