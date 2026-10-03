# Federated GraphQL Services

This directory contains the federated GraphQL services for the Tokenized Fractional RWA Marketplace.

## Services

### Assets Service (Port 4001)
Manages real-world asset metadata, ownership, and lifecycle.

**Schema:** `services/assets/schema.graphql`
**Resolvers:** `services/assets/resolvers.js`
**Server:** `services/assets/server.js`

### Users Service (Port 4002)
Manages user profiles, KYC status, and authentication.

**Schema:** `services/users/schema.graphql`
**Resolvers:** `services/users/resolvers.js`
**Server:** `services/users/server.js`

### Transactions Service (Port 4003)
Manages transaction records, purchases, and transfers.

**Schema:** `services/transactions/schema.graphql`
**Resolvers:** `services/transactions/resolvers.js`
**Server:** `services/transactions/server.js`

## Shared Infrastructure

### Service Client
Handles communication between federated services with caching and retry logic.

**File:** `services/shared/serviceClient.js`

### Error Handler
Comprehensive error handling with partial data support and circuit breaker pattern.

**File:** `services/shared/errorHandler.js`

### Monitoring
Performance monitoring for federated queries with metrics collection.

**File:** `services/shared/monitoring.js`

## Quick Start

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation

```bash
# Install dependencies for each service
cd services/assets && npm install
cd ../users && npm install
cd ../transactions && npm install
cd ../../gateway && npm install
```

### Running Services

#### Option 1: Individual Services
```bash
# Terminal 1 - Assets Service
cd services/assets
npm start

# Terminal 2 - Users Service
cd services/users
npm start

# Terminal 3 - Transactions Service
cd services/transactions
npm start

# Terminal 4 - Gateway
cd gateway
npm start
```

#### Option 2: Using Docker Compose
```bash
# From the backend directory
docker-compose up -d
```

### Environment Variables

Create a `.env` file in the backend directory:

```bash
# Gateway
GATEWAY_PORT=4000
ADMIN_API_KEY=your-secure-api-key

# Assets Service
ASSETS_SERVICE_PORT=4001
ASSETS_SERVICE_URL=http://localhost:4001

# Users Service
USERS_SERVICE_PORT=4002
USERS_SERVICE_URL=http://localhost:4002

# Transactions Service
TRANSACTIONS_SERVICE_PORT=4003
TRANSACTIONS_SERVICE_URL=http://localhost:4003
```

## Testing

### Test Individual Services
```bash
# Test Assets Service
curl -X POST http://localhost:4001/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "{ assets { contractId title } }"}'

# Test Users Service
curl -X POST http://localhost:4002/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "{ users { userId walletAddress } }"}'

# Test Transactions Service
curl -X POST http://localhost:4003/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "{ transactions { transactionId type } }"}'
```

### Test Gateway
```bash
# Test federated query through gateway
curl -X POST http://localhost:4000/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "{ asset(contractId: \"C123...\") { title owner { walletAddress } } }"}'
```

## Architecture

See [GraphQL Federation Architecture Documentation](../../docs/GRAPHQL_FEDERATION_ARCHITECTURE.md) for detailed architecture information.

## Monitoring

Each service exposes metrics at `/metrics` endpoint (when integrated with Prometheus).

## Health Checks

Each service provides a health check endpoint:
- `GET /health` - Returns service health status

## Troubleshooting

### Service Won't Start
- Check if port is already in use
- Verify environment variables are set
- Check service logs for errors

### Gateway Composition Errors
- Ensure all services are running
- Verify service URLs are correct
- Check schema compatibility

### Partial Data Responses
- Check service health
- Review error logs
- Verify network connectivity

## Development

### Adding New Fields to Schema
1. Update the schema.graphql file
2. Add resolver logic in resolvers.js
3. Test the changes locally
4. Update documentation

### Adding New Services
1. Create new service directory
2. Define federated schema with @key directives
3. Implement resolvers
4. Create server.js
5. Add to gateway service list
6. Update documentation

## Deployment

### Production Deployment
1. Use environment-specific configuration
2. Enable authentication/authorization
3. Set up monitoring and alerting
4. Configure rate limiting
5. Enable caching
6. Use load balancer for gateway

### Docker Deployment
See `docker-compose.yml` in the backend directory for containerized deployment.

## Support

For issues and questions:
- Check the [Architecture Documentation](../../docs/GRAPHQL_FEDERATION_ARCHITECTURE.md)
- Review service logs
- Check Apollo Federation documentation
