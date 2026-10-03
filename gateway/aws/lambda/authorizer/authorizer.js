/**
 * AWS Lambda Custom Authorizer
 * Validates JWT tokens and API keys
 */

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

/**
 * Generates IAM policy for API Gateway
 */
function generatePolicy(principalId, effect, resource) {
  const authResponse = {
    principalId,
  };

  if (effect && resource) {
    const policyStatement = {
      Action: 'execute-api:Invoke',
      Effect: effect,
      Resource: resource,
    };
    authResponse.policyDocument = {
      Version: '2012-10-17',
      Statement: [policyStatement],
    };
  }

  return authResponse;
}

/**
 * Lambda handler for custom authorization
 */
exports.handler = async (event, context) => {
  console.log('Authorization event:', JSON.stringify(event));

  const token = event.authorizationToken;
  if (!token) {
    throw new Error('Unauthorized: missing authorization token');
  }

  try {
    // Extract Bearer token
    const bearerToken = token.startsWith('Bearer ') ? token.slice(7) : token;

    // Verify JWT signature
    const decoded = jwt.verify(bearerToken, JWT_SECRET, {
      algorithms: ['HS256'],
    });

    console.log('Token verified:', decoded);

    // Generate allow policy
    return generatePolicy(decoded.sub || decoded.email, 'Allow', event.methodArn);
  } catch (error) {
    console.error('Authorization error:', error.message);
    throw new Error('Unauthorized: invalid token');
  }
};
