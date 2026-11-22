import { Contract, Networks, rpc, TransactionBuilder } from '@stellar/stellar-sdk';
import {
  extractContractVersion,
  warnOnIncompatibleCombination,
  type CompatibilityReport,
} from './compatibility.js';

export type TransactionSigner = (xdr: string, networkPassphrase: string) => Promise<string>;

export interface SorobanClientOptions {
  rpcUrl: string;
  contractId: string;
  networkPassphrase?: string;
  server?: rpc.Server;
  signer?: TransactionSigner;
}

export class SorobanClient {
  readonly contractId: string;
  readonly networkPassphrase: string;
  private readonly contract: Contract;
  private readonly server: rpc.Server;
  private readonly signer?: TransactionSigner;

  constructor(options: SorobanClientOptions) {
    if (options.contractId.length < 50) throw new Error('A valid Soroban contractId is required');
    this.contractId = options.contractId;
    this.networkPassphrase = options.networkPassphrase ?? Networks.TESTNET;
    this.contract = new Contract(options.contractId);
    this.server = options.server ?? new rpc.Server(options.rpcUrl);
    this.signer = options.signer;
  }

  async read<T = unknown>(method: string, accountId: string, args: unknown[] = []): Promise<T> {
    const account = await this.server.getAccount(accountId);
    const transaction = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call(method, ...(args as never[])))
      .setTimeout(30)
      .build();
    const simulation = await this.server.simulateTransaction(transaction);
    if ('error' in simulation && simulation.error) throw new Error(simulation.error);
    return (simulation as { result?: T }).result as T;
  }

  async write(method: string, accountId: string, args: unknown[] = [], fee = '10000') {
    if (!this.signer) throw new Error('A transaction signer is required for write operations');
    const account = await this.server.getAccount(accountId);
    let transaction = new TransactionBuilder(account, {
      fee,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call(method, ...(args as never[])))
      .setTimeout(30)
      .build();
    const simulation = await this.server.simulateTransaction(transaction);
    if ('error' in simulation && simulation.error) throw new Error(simulation.error);
    transaction = rpc.assembleTransaction(transaction, simulation).build();
    const signedXdr = await this.signer(transaction.toXDR(), this.networkPassphrase);
    return this.server.sendTransaction(
      TransactionBuilder.fromXDR(signedXdr, this.networkPassphrase),
    );
  }

  /**
   * Read the deployed contract's `get_contract_metadata().version`
   * (the same value tracked in contracts/src/lib.rs contract metadata).
   * Requires a funded `accountId` because the read is a simulation, like
   * every other contract read in this client.
   */
  async getContractVersion(accountId: string): Promise<string | null> {
    const metadata = await this.read<unknown>('get_contract_metadata', accountId);
    return extractContractVersion(metadata);
  }

  /**
   * Check the deployed contract version against the SDK compatibility
   * matrix (Issue #888) and warn on a known-incompatible combination.
   * Best-effort: if the version cannot be read, no incompatibility is
   * asserted and a single warning is emitted instead.
   */
  async checkCompatibility(
    accountId: string,
    warn: (message: string) => void = console.warn,
  ): Promise<CompatibilityReport> {
    let contractVersion: string | null = null;
    try {
      contractVersion = await this.getContractVersion(accountId);
    } catch (error) {
      warn(`Could not determine contract version: ${(error as Error).message}`);
    }
    return warnOnIncompatibleCombination({ contractVersion }, warn);
  }
}
