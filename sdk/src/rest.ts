export interface Asset {
  contractId: string;
  title?: string;
  location?: string;
  description?: string;
  assetType?: string;
  imageUrl?: string;
  totalValuation?: number | string;
  [key: string]: unknown;
}

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AssetList {
  data: Asset[];
  pagination: Pagination;
}

export interface AssetQuery {
  assetType?: string;
  location?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface RwaApiClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetch?: typeof fetch;
  headers?: HeadersInit;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    const message = typeof body === 'object' && body !== null && 'error' in body
      ? String((body as { error: unknown }).error)
      : `API request failed with status ${status}`;
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export class RwaApiClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly requestFetch: typeof fetch;
  private readonly defaultHeaders: HeadersInit;

  constructor(options: RwaApiClientOptions) {
    if (!options.baseUrl) throw new Error('RwaApiClient requires a baseUrl');
    this.baseUrl = options.baseUrl.replace(/\/$/, '').replace(/\/api\/(?:v1|v1\/$)/, '');
    this.apiKey = options.apiKey;
    this.requestFetch = options.fetch ?? globalThis.fetch;
    this.defaultHeaders = options.headers ?? {};
  }

  async listAssets(query: AssetQuery = {}): Promise<AssetList> {
    return this.get<AssetList>('/rwa', query);
  }

  async searchAssets(query: AssetQuery & { search: string }): Promise<AssetList> {
    return this.get<AssetList>('/rwa/search', query);
  }

  async getHealth(): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>('/api-monitor/health');
  }

  private async get<T>(path: string, query: object = {}): Promise<T> {
    const url = new URL(`/api/v1${path}`, `${this.baseUrl}/`);
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    });

    const response = await this.requestFetch(url, {
      headers: {
        Accept: 'application/json',
        ...this.defaultHeaders,
        ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
      },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(response.status, body);
    return body as T;
  }
}
