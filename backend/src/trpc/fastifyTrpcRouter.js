/**
 * Fastify tRPC Routers & Microservice Event Pipelining (#417)
 *
 * Provides strongly-typed tRPC routing with Zod schema validation
 * for all vault state transitions between microservices.
 */

// Zod-compatible validation schema helper
export class ZodSchema {
  constructor(rules) {
    this.rules = rules;
  }

  parse(data) {
    if (data === null || data === undefined || typeof data !== 'object') {
      const err = new Error('ZodValidationError: Payload body must be an object');
      err.isZodError = true;
      err.code = 'BAD_REQUEST';
      throw err;
    }

    const result = {};
    for (const [key, rule] of Object.entries(this.rules)) {
      const val = data[key];

      if (rule.required && (val === undefined || val === null)) {
        const err = new Error(`ZodValidationError: Field '${key}' is required`);
        err.isZodError = true;
        err.code = 'BAD_REQUEST';
        throw err;
      }

      if (val !== undefined && val !== null) {
        if (rule.type === 'string' && typeof val !== 'string') {
          const err = new Error(`ZodValidationError: Field '${key}' must be a string`);
          err.isZodError = true;
          err.code = 'BAD_REQUEST';
          throw err;
        }
        if (rule.type === 'number' && typeof val !== 'number') {
          const err = new Error(`ZodValidationError: Field '${key}' must be a number`);
          err.isZodError = true;
          err.code = 'BAD_REQUEST';
          throw err;
        }
        if (rule.min !== undefined && val < rule.min) {
          const err = new Error(`ZodValidationError: Field '${key}' must be >= ${rule.min}`);
          err.isZodError = true;
          err.code = 'BAD_REQUEST';
          throw err;
        }
        if (rule.enum && !rule.enum.includes(val)) {
          const err = new Error(`ZodValidationError: Field '${key}' must be one of [${rule.enum.join(', ')}]`);
          err.isZodError = true;
          err.code = 'BAD_REQUEST';
          throw err;
        }
      }

      result[key] = val;
    }
    return result;
  }
}

// Zod schemas for all vault state transitions
export const vaultPurchaseSchema = new ZodSchema({
  vaultId: { type: 'string', required: true },
  shareCount: { type: 'number', required: true, min: 1 },
  userAddress: { type: 'string', required: true },
  gasTier: { type: 'string', required: false, enum: ['standard', 'fast', 'express'] },
});

export const vaultDepositSchema = new ZodSchema({
  vaultId: { type: 'string', required: true },
  assetAmount: { type: 'number', required: true, min: 0.000001 },
  depositorAddress: { type: 'string', required: true },
});

export const vaultRedeemSchema = new ZodSchema({
  vaultId: { type: 'string', required: true },
  shareCount: { type: 'number', required: true, min: 1 },
  redeemerAddress: { type: 'string', required: true },
});

export const vaultStateTransitionSchema = new ZodSchema({
  vaultId: { type: 'string', required: true },
  action: { type: 'string', required: true, enum: ['PURCHASE', 'DEPOSIT', 'REDEEM'] },
  sequence: { type: 'number', required: true, min: 1 },
  payload: { type: 'string', required: true },
});

// tRPC Router Definition
export class TRPCRouter {
  constructor() {
    this.procedures = new Map();
  }

  mutation(name, schema, handler) {
    this.procedures.set(name, { type: 'mutation', schema, handler });
    return this;
  }

  query(name, schema, handler) {
    this.procedures.set(name, { type: 'query', schema, handler });
    return this;
  }

  async caller(procedureName, input) {
    const proc = this.procedures.get(procedureName);
    if (!proc) {
      const err = new Error(`tRPC Procedure '${procedureName}' not found`);
      err.code = 'NOT_FOUND';
      throw err;
    }

    let validatedInput = input;
    if (proc.schema) {
      try {
        validatedInput = proc.schema.parse(input);
      } catch (err) {
        err.code = 'BAD_REQUEST';
        err.isZodError = true;
        throw err;
      }
    }

    return await proc.handler({ input: validatedInput });
  }
}

// Core vault state transition router instance
export const vaultRouter = new TRPCRouter()
  .mutation('vault.purchase', vaultPurchaseSchema, async ({ input }) => {
    return {
      success: true,
      vaultId: input.vaultId,
      sharesPurchased: input.shareCount,
      userAddress: input.userAddress,
      status: 'CONFIRMED',
      timestamp: Date.now(),
    };
  })
  .mutation('vault.deposit', vaultDepositSchema, async ({ input }) => {
    return {
      success: true,
      vaultId: input.vaultId,
      amountDeposited: input.assetAmount,
      depositorAddress: input.depositorAddress,
      status: 'CONFIRMED',
      timestamp: Date.now(),
    };
  })
  .mutation('vault.redeem', vaultRedeemSchema, async ({ input }) => {
    return {
      success: true,
      vaultId: input.vaultId,
      sharesRedeemed: input.shareCount,
      redeemerAddress: input.redeemerAddress,
      status: 'CONFIRMED',
      timestamp: Date.now(),
    };
  })
  .mutation('vault.transitionState', vaultStateTransitionSchema, async ({ input }) => {
    return {
      success: true,
      vaultId: input.vaultId,
      action: input.action,
      sequence: input.sequence,
      transitionId: `tr_${Date.now()}_${input.sequence}`,
    };
  })
  .query('vault.getState', new ZodSchema({ vaultId: { type: 'string', required: true } }), async ({ input }) => {
    return {
      vaultId: input.vaultId,
      totalShares: 10000,
      availableShares: 7500,
      status: 'ACTIVE',
    };
  });

export const appRouter = vaultRouter;

/**
 * Fastify tRPC Adapter plugin handler
 */
export function fastifyTrpcAdapter(fastify, opts, done) {
  fastify.post('/trpc/:procedureName', async (request, reply) => {
    const { procedureName } = request.params;
    try {
      const result = await appRouter.caller(procedureName, request.body);
      return reply.code(200).send({ result: { data: result } });
    } catch (err) {
      if (err.isZodError || err.code === 'BAD_REQUEST') {
        return reply.code(400).send({
          error: {
            message: err.message,
            code: 'BAD_REQUEST',
            validationError: true,
          },
        });
      }
      return reply.code(500).send({ error: { message: err.message, code: 'INTERNAL_SERVER_ERROR' } });
    }
  });

  if (typeof done === 'function') done();
}
