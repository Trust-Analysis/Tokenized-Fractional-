// Service Communication Client
// Handles communication between federated services via REST and GraphQL

class ServiceClient {
  constructor(serviceUrl, timeout = 5000) {
    this.serviceUrl = serviceUrl;
    this.timeout = timeout;
    this.cache = new Map();
    this.cacheTTL = 30000; // 30 seconds
  }

  /**
   * Execute a GraphQL query on a federated service
   */
  async query(query, variables = {}, operationName = null) {
    const cacheKey = this.getCacheKey(query, variables);
    
    // Check cache first
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTTL) {
        return cached.data;
      }
    }

    try {
      const response = await fetch(this.serviceUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ADMIN_API_KEY
        },
        body: JSON.stringify({
          query,
          variables,
          operationName
        }),
        signal: AbortSignal.timeout(this.timeout)
      });

      if (!response.ok) {
        throw new Error(`Service request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      // Cache successful responses
      this.cache.set(cacheKey, {
        data,
        timestamp: Date.now()
      });

      return data;
    } catch (error) {
      console.error(`Service communication error: ${error.message}`);
      throw new Error(`Failed to communicate with service: ${error.message}`);
    }
  }

  /**
   * Execute a REST GET request
   */
  async get(endpoint, headers = {}) {
    const url = `${this.serviceUrl}${endpoint}`;
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        signal: AbortSignal.timeout(this.timeout)
      });

      if (!response.ok) {
        throw new Error(`REST GET failed: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`REST GET error: ${error.message}`);
      throw new Error(`Failed to fetch from service: ${error.message}`);
    }
  }

  /**
   * Execute a REST POST request
   */
  async post(endpoint, body, headers = {}) {
    const url = `${this.serviceUrl}${endpoint}`;
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeout)
      });

      if (!response.ok) {
        throw new Error(`REST POST failed: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`REST POST error: ${error.message}`);
      throw new Error(`Failed to post to service: ${error.message}`);
    }
  }

  /**
   * Generate cache key for query
   */
  getCacheKey(query, variables) {
    return `${query.substring(0, 50)}_${JSON.stringify(variables)}`;
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Set cache TTL
   */
  setCacheTTL(ttl) {
    this.cacheTTL = ttl;
  }
}

/**
 * Service registry for managing multiple service clients
 */
class ServiceRegistry {
  constructor() {
    this.clients = new Map();
  }

  /**
   * Register a service
   */
  register(name, url, timeout = 5000) {
    this.clients.set(name, new ServiceClient(url, timeout));
  }

  /**
   * Get a service client
   */
  get(name) {
    const client = this.clients.get(name);
    if (!client) {
      throw new Error(`Service '${name}' not registered`);
    }
    return client;
  }

  /**
   * Check if service is registered
   */
  has(name) {
    return this.clients.has(name);
  }

  /**
   * Remove a service
   */
  unregister(name) {
    this.clients.delete(name);
  }

  /**
   * Clear all service caches
   */
  clearAllCaches() {
    this.clients.forEach(client => client.clearCache());
  }
}

// Create global service registry
const serviceRegistry = new ServiceRegistry();

// Register default services
serviceRegistry.register('assets', process.env.ASSETS_SERVICE_URL || 'http://localhost:4001');
serviceRegistry.register('users', process.env.USERS_SERVICE_URL || 'http://localhost:4002');
serviceRegistry.register('transactions', process.env.TRANSACTIONS_SERVICE_URL || 'http://localhost:4003');

export { ServiceClient, ServiceRegistry, serviceRegistry };
