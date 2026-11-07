# GraphQL Quick Start

## 30-Second Setup

### 1. Install Dependencies
```bash
cd backend
npm install
```

### 2. Start Backend
```bash
npm run dev
```

### 3. Open GraphQL Playground
```
http://localhost:3001/graphql
```

Apollo Sandbox will open automatically with introspection ready.

---

## First Query (30 seconds)

Copy and paste into Apollo Sandbox:

```graphql
query {
  assets(limit: 5) {
    contractId
    title
    location
    pricePerShare
  }
}
```

Press the play button. You'll see marketplace assets.

---

## First Mutation (Admin)

```graphql
mutation {
  createAsset(
    input: {
      title: "My First Asset"
      location: "San Francisco, CA"
      description: "A great asset"
      assetType: "residential"
      totalShares: 1000
      pricePerShare: 10000000
      availableShares: 1000
    }
  ) {
    contractId
    title
  }
}
```

**Headers:** Add `x-api-key: YOUR_ADMIN_API_KEY`

---

## Common Queries

### Get Marketplace Stats
```graphql
query {
  statistics {
    totalAssets
    totalSharesAvailable
    averagePricePerShare
  }
}
```

### Search Assets
```graphql
query {
  searchAssets(query: "office", limit: 10) {
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
    availableShares
  }
}
```

---

## Common Mutations (Admin)

### Update Asset
```graphql
mutation {
  updateAsset(
    contractId: "CAQK..."
    input: {
      title: "Updated Title"
      location: "New York, NY"
      description: "New description"
      assetType: "commercial_real_estate"
      totalShares: 2000
      pricePerShare: 15000000
      availableShares: 1500
    }
  ) {
    contractId
    title
    updatedAt
  }
}
```

### Pause Asset
```graphql
mutation {
  pauseAsset(contractId: "CAQK...") {
    contractId
    isPaused
  }
}
```

### Delete Asset
```graphql
mutation {
  deleteAsset(contractId: "CAQK...")
}
```

---

## Integration Examples

### JavaScript
```javascript
const query = `
  query {
    assets(limit: 10) {
      contractId
      title
      location
    }
  }
`;

const response = await fetch('http://localhost:3001/graphql', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query })
});

const data = await response.json();
console.log(data);
```

### cURL
```bash
curl -X POST http://localhost:3001/graphql \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query { assets(limit: 5) { contractId title } }"
  }'
```

### Python
```python
import requests

query = """
  query {
    assets(limit: 5) {
      contractId
      title
      location
    }
  }
"""

response = requests.post(
  'http://localhost:3001/graphql',
  json={'query': query}
)
print(response.json())
```

---

## API Key Setup (For Mutations)

**Set your admin API key:**

1. Open Apollo Sandbox at `http://localhost:3001/graphql`
2. Click the **Headers** tab (bottom left)
3. Add:
   ```json
   {
     "x-api-key": "YOUR_ADMIN_API_KEY"
   }
   ```
4. Now mutations will work

**Get your API key from:**
- Environment variable: `ADMIN_API_KEY` in `.env`
- Backend logs on startup

---

## Troubleshooting

### "Cannot POST /graphql"
- Verify backend is running (`npm run dev`)
- Check port is 3001
- Try http://localhost:3001/graphql

### "Unauthorized: Only admins"
- Add `x-api-key` header in Apollo Sandbox
- Verify key is correct (check backend logs)
- Restart backend if key was changed

### "Asset not found"
- Verify contractId is correct
- Try querying all assets first: `query { assets { contractId } }`

### Sandbox shows blank
- Try refreshing page
- Check browser console for errors
- Verify backend is running

---

## Next Steps

1. **Read full docs:** `docs/GRAPHQL_API.md`
2. **Explore schema:** Use Apollo Sandbox introspection
3. **Run tests:** `npm test -- graphql.test.js`
4. **Try advanced queries:** See `docs/GRAPHQL_API.md`
5. **Build your app:** Use in React, Vue, etc.

---

## More Help

- **GraphQL Intro:** https://graphql.org/learn/
- **Apollo Docs:** https://www.apollographql.com/docs/
- **Full API Docs:** `docs/GRAPHQL_API.md`
- **Implementation Details:** `GRAPHQL_IMPLEMENTATION.md`
