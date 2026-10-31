// backend/scripts/verify-openapi.js
const listEndpoints = require('express-list-endpoints');
const request = require('supertest');
let app;

try {
  app = require('../index.js');
  if (!app || typeof app.use !== 'function') {
    console.error("❌ Express app is not properly exported from backend/index.js.");
    process.exit(1);
  }
} catch (err) {
  console.error("❌ Failed to load Express app:", err.message);
  process.exit(1);
}

async function verifyOpenAPI() {
  console.log("🔍 Fetching OpenAPI spec from /api-docs.json...");

  let openApiSpec;
  try {
    const res = await request(app).get('/api-docs.json');
    if (res.status !== 200) {
      throw new Error(`Failed to fetch spec. Status: ${res.status}`);
    }
    openApiSpec = res.body;
  } catch (err) {
    console.error("❌ Could not fetch OpenAPI spec:", err.message);
    process.exit(1);
  }

  console.log("🔍 Extracting live routes from Express...");
  const endpoints = listEndpoints(app);
  const expressRoutes = [];

  endpoints.forEach(endpoint => {
    endpoint.methods.forEach(method => {
      // Convert Express path parameters like :contractId to OpenAPI format {contractId}
      let openapiPath = endpoint.path.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');

      // Ignore infrastructure, metrics, and swagger routes
      if (
        openapiPath.startsWith('/api-docs') ||
        openapiPath === '/health' ||
        openapiPath.startsWith('/metrics') ||
        openapiPath === '*'
      ) {
        return;
      }

      expressRoutes.push({
        path: openapiPath,
        method: method.toLowerCase()
      });
    });
  });

  const documentedRoutes = [];
  if (openApiSpec && openApiSpec.paths) {
    Object.keys(openApiSpec.paths).forEach(pathKey => {
      Object.keys(openApiSpec.paths[pathKey]).forEach(method => {
        documentedRoutes.push({
          path: pathKey,
          method: method.toLowerCase()
        });
      });
    });
  }

  let hasError = false;
  console.log("\n⚖️  Comparing Documented vs Live Express Routes...\n");

  expressRoutes.forEach(expressRoute => {
    const isDocumented = documentedRoutes.some(
      docRoute => docRoute.path === expressRoute.path && docRoute.method === expressRoute.method
    );

    if (!isDocumented) {
      console.error(`❌ Undocumented Route (Live in Express, missing in OpenAPI): [${expressRoute.method.toUpperCase()}] ${expressRoute.path}`);
      hasError = true;
    }
  });

  documentedRoutes.forEach(docRoute => {
    const existsInExpress = expressRoutes.some(
      expressRoute => expressRoute.path === docRoute.path && expressRoute.method === docRoute.method
    );

    if (!existsInExpress) {
      console.error(`❌ Ghost Route (Documented in OpenAPI, missing in Express): [${docRoute.method.toUpperCase()}] ${docRoute.path}`);
      hasError = true;
    }
  });

  if (hasError) {
    console.error("\n❌ OpenAPI drift detected! Please update your Swagger spec to match the live Express routes.");
    process.exit(1);
  } else {
    console.log("✅ All Express routes are perfectly synchronized with the OpenAPI spec.");
    process.exit(0);
  }
}

verifyOpenAPI();
