import { describe, it, expect } from '@jest/globals';
import {
  appRouter,
  vaultPurchaseSchema,
  vaultStateTransitionSchema,
} from '../src/trpc/fastifyTrpcRouter.js';

describe('Issue #417: Integrate Fastify tRPC routers for microservice event pipelining', () => {
  it('executes cross-service vault purchase calls with fully inferred payload structures', async () => {
    const payload = {
      vaultId: 'v-999',
      shareCount: 25,
      userAddress: 'GUSER123456789',
      gasTier: 'fast',
    };

    const res = await appRouter.caller('vault.purchase', payload);

    expect(res.success).toBe(true);
    expect(res.vaultId).toBe('v-999');
    expect(res.sharesPurchased).toBe(25);
    expect(res.status).toBe('CONFIRMED');
  });

  it('automatically rejects invalid payload requests via Zod validation (missing required field)', async () => {
    const invalidPayload = {
      vaultId: 'v-999',
      // shareCount is missing
      userAddress: 'GUSER123456789',
    };

    await expect(appRouter.caller('vault.purchase', invalidPayload)).rejects.toThrow(
      "ZodValidationError: Field 'shareCount' is required"
    );
  });

  it('automatically rejects invalid payload requests (invalid field type or min constraint)', async () => {
    const invalidPayload = {
      vaultId: 'v-999',
      shareCount: 0, // min is 1
      userAddress: 'GUSER123456789',
    };

    await expect(appRouter.caller('vault.purchase', invalidPayload)).rejects.toThrow(
      "ZodValidationError: Field 'shareCount' must be >= 1"
    );
  });

  it('validates vault state transition payloads correctly', async () => {
    const transitionPayload = {
      vaultId: 'v-100',
      action: 'DEPOSIT',
      sequence: 42,
      payload: JSON.stringify({ amount: 500 }),
    };

    const res = await appRouter.caller('vault.transitionState', transitionPayload);

    expect(res.success).toBe(true);
    expect(res.sequence).toBe(42);
    expect(res.action).toBe('DEPOSIT');
  });
});
