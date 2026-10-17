# GraphQL API Documentation

## Overview

The RWA Marketplace now provides a GraphQL API endpoint for querying and mutating real-world asset data. GraphQL offers a flexible, strongly-typed alternative to REST with a single unified endpoint and the ability to request exactly the data you need.

**GraphQL Endpoint:** `http://localhost:3001/graphql`  
**Apollo Sandbox:** Available at the endpoint URL (interactive explorer)

## Quick Start

### Access GraphQL Playground

1. Start the backend: `npm run dev`
2. Open `http://localhost:3001/graphql` in your browser
3. Apollo Sandbox will load automatically
4. Start writing queries and mutations

## Authentication

All queries are public. Mutations require admin authentication via the `x-api-key` header:

```graphql
Header: x-api-key: YOUR_ADMIN_API_KEY
```

**Without the header:** Queries work, mutations return "Unauthorized" error  
**With invalid key:** Same authorization error

## Query Examples

### Get All Assets

```graphql
query {
  assets(limit: 10, offset: 0) {
    contractId
    title
    location
    assetType
    totalShares
    pricePerShare
    availableShares
    isPaused
  }
}
```

**Response:**
```json
{
  "data": {
    "assets": [
      {
        "contractId": "CAQK...",
        "title": "Manhattan Office Building",
        "location": "New York, NY",
        "assetType": "commercial_real_estate",
        "totalShares": 1000,
        "pricePerShare": 10000000,
        "availableShares": 450,
        "isPaused": false
      }
    ]
  }
}
```

### Filter Assets

```graphql
query {
  assets(
    filter: {
      search: "office"
      assetType: "commercial_real_estate"
      location: "New York"
    }
  ) {
    contractId
    title
    location
  }
}
```

### Get Single Asset

```graphql
query {
  asset(contractId: "CAQK...") {
    contractId
    title
    description
    location
    assetType
    totalShares
    pricePerShare
    availableShares
    isPaused
    createdAt
    updatedAt
  }
}
```

### Search Assets

```graphql
query {
  searchAssets(query: "commercial real estate", limit: 5) {
    contractId
    title
    location
    description
  }
}
```

### Get Marketplace Statistics

```graphql
query {
  statistics {
    totalAssets
    pendingAssets
    totalSharesAvailable
    averagePricePerShare
  }
}
```

**Response:**
```json
{
  "data": {
    "statistics": {
      "totalAssets": 42,
      "pendingAssets": 3,
      "totalSharesAvailable": 15000,
      "averagePricePerShare": 12500000.5
    }
  }
}
```

### Get Pending Assets (Admin Only)

```graphql
query {
  pendingAssets {
    contractId
    title
    location
    assetType
    createdAt
  }
}
```

### Get Assets Count

```graphql
query {
  assetsCount
}
```

## Mutation Examples

### Create Asset

```graphql
mutation {
  createAsset(
    input: {
      title: "Downtown Hotel"
      location: "Las Vegas, NV"
      description: "5-star hotel with 500 rooms"
      assetType: "hospitality"
      totalShares: 2000
      pricePerShare: 5000000
      availableShares: 2000
    }
  ) {
    contractId
    title
    location
    isPaused
    createdAt
  }
}
```

**Response:**
```json
{
  "data": {
    "createAsset": {
      "contractId": "CNEW...",
      "title": "Downtown Hotel",
      "location": "Las Vegas, NV",
      "isPaused": false,
      "createdAt": "2026-06-30T08:32:26Z"
    }
  }
}
```

### Update Asset

```graphql
mutation {
  updateAsset(
    contractId: "CAQK..."
    input: {
      title: "Updated Title"
      location: "New York, NY"
      description: "Updated description"
      assetType: "commercial_real_estate"
      totalShares: 1000
      pricePerShare: 15000000
      availableShares: 400
    }
  ) {
    contractId
    title
    pricePerShare
    updatedAt
  }
}
```

### Approve Asset (Admin)

```graphql
mutation {
  approveAsset(contractId: "CAQK...") {
    contractId
    title
    createdAt
  }
}
```

### Pause Asset (Admin)

```graphql
mutation {
  pauseAsset(contractId: "CAQK...") {
    contractId
    title
    isPaused
  }
}
```

### Unpause Asset (Admin)

```graphql
mutation {
  unpauseAsset(contractId: "CAQK...") {
    contractId
    isPaused
  }
}
```

### Delete Asset (Admin)

```graphql
mutation {
  deleteAsset(contractId: "CAQK...")
}
```

**Response:**
```json
{
  "data": {
    "deleteAsset": true
  }
}
```

## Schema Reference

### Types

#### RWA
Represents a real-world asset in the marketplace.

| Field | Type | Description |
|-------|------|-------------|
| `contractId` | `String!` | Unique Stellar contract ID |
| `title` | `String!` | Asset title |
| `location` | `String!` | Geographic location |
| `description` | `String!` | Detailed description |
| `assetType` | `String!` | Asset category |
| `totalShares` | `Int` | Total fractional shares |
| `pricePerShare` | `Int` | Price in stroops |
| `availableShares` | `Int` | Remaining shares |
| `isPaused` | `Boolean` | Trading status |
| `documents` | `[DocumentHash!]` | IPFS file hashes |
| `createdAt` | `String` | Creation timestamp |
| `updatedAt` | `String` | Last update timestamp |

#### Statistics
Marketplace-wide statistics.

| Field | Type | Description |
|-------|------|-------------|
| `totalAssets` | `Int!` | Total assets |
| `pendingAssets` | `Int!` | Assets awaiting approval |
| `totalSharesAvailable` | `Int!` | Total shares across all assets |
| `averagePricePerShare` | `Float!` | Average price per share |

#### DocumentHash
IPFS document reference.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `String!` | File name/identifier |
| `hash` | `String!` | IPFS content hash |
| `mimeType` | `String` | File MIME type |
| `uploadedAt` | `String` | Upload timestamp |

### Input Types

#### RWAInput
Used for creating and updating assets.

```graphql
input RWAInput {
  title: String!
  location: String!
  description: String!
  assetType: String!
  totalShares: Int
  pricePerShare: Int
  availableShares: Int
}
```

#### RWAFilter
Used for filtering assets in queries.

```graphql
input RWAFilter {
  search: String
  assetType: String
  location: String
}
```

### Query Operations

| Query | Returns | Auth | Description |
|-------|---------|------|-------------|
| `assets(filter, limit, offset)` | `[RWA!]!` | Public | List assets with filtering |
| `assetsCount` | `Int!` | Public | Total asset count |
| `asset(contractId)` | `RWA` | Public | Single asset by ID |
| `searchAssets(query, limit)` | `[RWA!]!` | Public | Full-text search |
| `pendingAssets` | `[RWA!]!` | Admin | Unpublished assets |
| `statistics` | `Statistics!` | Public | Marketplace stats |

### Mutation Operations

| Mutation | Returns | Auth | Description |
|----------|---------|------|-------------|
| `createAsset(input)` | `RWA!` | Admin | Create new asset |
| `updateAsset(contractId, input)` | `RWA!` | Admin | Update existing asset |
| `deleteAsset(contractId)` | `Boolean!` | Admin | Delete asset |
| `approveAsset(contractId)` | `RWA!` | Admin | Approve pending asset |
| `pauseAsset(contractId)` | `RWA!` | Admin | Pause trading |
| `unpauseAsset(contractId)` | `RWA!` | Admin | Resume trading |

## Error Handling

### Authorization Errors

```json
{
  "errors": [
    {
      "message": "Unauthorized: Only admins can create assets",
      "extensions": {
        "code": "UNAUTHENTICATED"
      }
    }
  ]
}
```

### Validation Errors

```json
{
  "errors": [
    {
      "message": "Missing required fields: title, location",
      "extensions": {
        "code": "INTERNAL_SERVER_ERROR"
      }
    }
  ]
}
```

### Not Found Errors

```json
{
  "errors": [
    {
      "message": "Asset not found",
      "extensions": {
        "code": "INTERNAL_SERVER_ERROR"
      }
    }
  ]
}
```

## Advanced Queries

### Batch Operations

```graphql
query {
  assets1: assets(filter: { assetType: "commercial_real_estate" }, limit: 5) {
    contractId
    title
  }
  assets2: assets(filter: { assetType: "residential" }, limit: 5) {
    contractId
    title
  }
  stats: statistics {
    totalAssets
    totalSharesAvailable
  }
}
```

### With Variables

```graphql
query GetAsset($id: String!) {
  asset(contractId: $id) {
    contractId
    title
    description
    location
  }
}
```

**Variables:**
```json
{
  "id": "CAQK..."
}
```

## Performance Tips

1. **Request only needed fields** - GraphQL lets you specify exactly what you need
2. **Use pagination** - Limit results with `limit` and `offset` parameters
3. **Batch queries** - Combine multiple queries in one request
4. **Use variables** - For dynamic queries and better caching

## Comparison: REST vs GraphQL

### REST (Multiple endpoints)
```
GET /api/v1/rwa                    # Get all assets
GET /api/v1/rwa/:contractId        # Get single asset
POST /api/v1/rwa                   # Create asset (admin)
PATCH /api/v1/rwa/:contractId      # Update asset (admin)
DELETE /api/v1/rwa/:contractId     # Delete asset (admin)
GET /api/v1/rwa/search?q=office    # Search assets
```

### GraphQL (Single endpoint)
```
POST /graphql                       # All operations
```

**GraphQL Advantages:**
- Single request for related data
- Specify exact fields needed
- Strongly typed schema
- Better documentation
- Introspection support

## Integration Examples

### JavaScript/Node.js

```javascript
import { ApolloClient, InMemoryCache, gql, HttpLink } from '@apollo/client';

const client = new ApolloClient({
  link: new HttpLink({
    uri: 'http://localhost:3001/graphql',
    headers: {
      'x-api-key': 'your-admin-api-key', // Optional, only for mutations
    },
  }),
  cache: new InMemoryCache(),
});

// Query example
const { data } = await client.query({
  query: gql`
    query {
      assets(limit: 10) {
        contractId
        title
        location
      }
    }
  `,
});
```

### cURL

```bash
curl -X POST http://localhost:3001/graphql \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_ADMIN_API_KEY" \
  -d '{
    "query": "query { assets(limit: 5) { contractId title location } }"
  }'
```

### Python

```python
import requests

query = """
query {
  assets(limit: 10) {
    contractId
    title
    location
    pricePerShare
  }
}
"""

response = requests.post(
    'http://localhost:3001/graphql',
    json={'query': query}
)

data = response.json()
print(data)
```

## Troubleshooting

### Query returns null
- Check if asset `contractId` is correct
- Verify asset hasn't been deleted
- Try listing all assets to confirm data exists

### Mutation returns "Unauthorized"
- Verify `x-api-key` header is present
- Check API key is correct
- Ensure header capitalization: `x-api-key` (lowercase)

### GraphQL endpoint not responding
- Verify backend is running
- Check endpoint is `/graphql` not `/graphql/`
- Verify port is correct (default 3001)

## Next Steps

1. Explore the GraphQL schema in Apollo Sandbox
2. Try the query and mutation examples above
3. Build your client application
4. Combine with REST API for backward compatibility
5. Monitor GraphQL metrics in production

## Resources

- **Apollo Server Docs:** https://www.apollographql.com/docs/apollo-server/
- **GraphQL Introduction:** https://graphql.org/learn/
- **Schema Definition Language:** https://graphql.org/learn/schema/
