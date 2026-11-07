#!/usr/bin/env node
/**
 * AWS CDK Stack for RWA Marketplace API Gateway
 * Deploys API Gateway, Lambda integrations, authorization, and monitoring
 */

import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

/**
 * RWA Marketplace API Gateway Stack
 */
export class RwaApiGatewayStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ────────────────────────────────────────────────────────────────
    // API Gateway REST API
    // ────────────────────────────────────────────────────────────────
    const api = new apigateway.RestApi(this, 'RwaMarketplaceApi', {
      restApiName: 'RWA Marketplace API',
      description: 'Enterprise API Gateway for RWA Marketplace',
      deployOptions: {
        stageName: this.node.tryGetContext('environment') || 'prod',
        metricsEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        tracingEnabled: true,
      },
    });

    // ────────────────────────────────────────────────────────────────
    // CloudWatch Log Group for API Gateway
    // ────────────────────────────────────────────────────────────────
    const apiLogGroup = new logs.LogGroup(this, 'ApiGatewayLogs', {
      logGroupName: `/aws/apigateway/rwa-marketplace-api`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      retention: logs.RetentionDays.ONE_MONTH,
    });

    const apiRole = new iam.Role(this, 'ApiGatewayRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
    });

    apiRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['logs:CreateLogDelivery', 'logs:GetLogDelivery', 'logs:UpdateLogDelivery', 'logs:DeleteLogDelivery', 'logs:ListLogDeliveries'],
        resources: ['*'],
      })
    );

    // ────────────────────────────────────────────────────────────────
    // WAF WebACL for DDoS Protection
    // ────────────────────────────────────────────────────────────────
    const webAcl = new wafv2.CfnWebACL(this, 'RwaApiWaf', {
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: 'RwaApiWafMetrics',
      },
      rules: [
        // Rate limiting rule
        {
          name: 'RateLimitRule',
          priority: 0,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: 2000,
              aggregateKeyType: 'IP',
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'RateLimitRuleMetrics',
          },
        },
        // AWS managed rule group for common attacks
        {
          name: 'AWSManagedRulesCommonRuleSet',
          priority: 1,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              name: 'AWSManagedRulesCommonRuleSet',
              vendor: 'AWS',
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'CommonRuleSetMetrics',
          },
        },
      ],
    });

    // ────────────────────────────────────────────────────────────────
    // Custom Authorizer (API Key + JWT validation)
    // ────────────────────────────────────────────────────────────────
    const authorizerFunction = new lambda.Function(this, 'CustomAuthorizer', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'authorizer.handler',
      code: lambda.Code.fromAsset('lambda/authorizer'),
      environment: {
        JWT_SECRET: cdk.SecretValue.secretsManager('rwa-api-jwt-secret', {
          jsonField: 'secret',
        }).toString(),
      },
      timeout: cdk.Duration.seconds(30),
    });

    const authorizer = new apigateway.TokenAuthorizer(this, 'ApiAuthorizer', {
      handler: authorizerFunction,
      identitySource: 'method.request.header.Authorization',
      authorizerName: 'RwaApiAuthorizer',
      resultsCacheTtl: cdk.Duration.minutes(5),
    });

    // ────────────────────────────────────────────────────────────────
    // API Resource: /api
    // ────────────────────────────────────────────────────────────────
    const apiResource = api.root.addResource('api');

    // ────────────────────────────────────────────────────────────────
    // Resource: /api/rwa (GET - List all RWAs)
    // ────────────────────────────────────────────────────────────────
    const rwaResource = apiResource.addResource('rwa');

    rwaResource.addMethod('GET', new apigateway.HttpIntegration(
      this.node.tryGetContext('backendUrl') || 'http://localhost:3001',
      {
        httpMethod: 'GET',
        proxy: false,
        options: {
          requestParameters: {
            'integration.request.path.proxy': 'method.request.path.proxy',
          },
          requestTemplates: {
            'application/json': `{
              "statusCode": 200
            }`,
          },
          integrationResponses: [
            {
              statusCode: '200',
              responseTemplates: {
                'application/json': '$input.json("$")',
              },
            },
          ],
        },
      }
    ), {
      methodResponses: [{ statusCode: '200' }],
      requestParameters: {
        'method.request.header.Authorization': false,
      },
    });

    // ────────────────────────────────────────────────────────────────
    // Resource: /api/rwa/{contractId} (GET - Get specific RWA)
    // ────────────────────────────────────────────────────────────────
    const rwaIdResource = rwaResource.addResource('{contractId}');

    rwaIdResource.addMethod('GET', new apigateway.HttpIntegration(
      this.node.tryGetContext('backendUrl') || 'http://localhost:3001',
      {
        httpMethod: 'GET',
        proxy: false,
        options: {
          requestTemplates: {
            'application/json': `{
              "contractId": "$input.params('contractId')"
            }`,
          },
          integrationResponses: [
            {
              statusCode: '200',
              responseTemplates: {
                'application/json': '$input.json("$")',
              },
            },
          ],
        },
      }
    ), {
      methodResponses: [{ statusCode: '200' }],
    });

    // ────────────────────────────────────────────────────────────────
    // Resource: /api/rwa (POST - Create RWA - Requires Authorization)
    // ────────────────────────────────────────────────────────────────
    rwaResource.addMethod('POST', new apigateway.HttpIntegration(
      this.node.tryGetContext('backendUrl') || 'http://localhost:3001',
      {
        httpMethod: 'POST',
        proxy: false,
        options: {
          requestTemplates: {
            'application/json': '$input.json("$")',
          },
          integrationResponses: [
            {
              statusCode: '201',
              responseTemplates: {
                'application/json': '$input.json("$")',
              },
            },
          ],
        },
      }
    ), {
      authorizationType: apigateway.AuthorizationType.CUSTOM,
      authorizer,
      methodResponses: [{ statusCode: '201' }],
      requestParameters: {
        'method.request.header.Authorization': true,
      },
    });

    // ────────────────────────────────────────────────────────────────
    // Resource: /api/rwa/{contractId} (DELETE - Delete RWA - Requires Authorization)
    // ────────────────────────────────────────────────────────────────
    rwaIdResource.addMethod('DELETE', new apigateway.HttpIntegration(
      this.node.tryGetContext('backendUrl') || 'http://localhost:3001',
      {
        httpMethod: 'DELETE',
        proxy: false,
        options: {
          integrationResponses: [
            {
              statusCode: '204',
            },
          ],
        },
      }
    ), {
      authorizationType: apigateway.AuthorizationType.CUSTOM,
      authorizer,
      methodResponses: [{ statusCode: '204' }],
      requestParameters: {
        'method.request.header.Authorization': true,
      },
    });

    // ────────────────────────────────────────────────────────────────
    // CloudWatch Alarms
    // ────────────────────────────────────────────────────────────────
    const errorAlarm = new cloudwatch.Alarm(this, 'ApiErrorAlarm', {
      metric: api.metricServerError(),
      threshold: 10,
      evaluationPeriods: 1,
      alarmName: 'RWA-API-ServerErrors',
      alarmDescription: 'Alert when API Gateway returns 5xx errors',
    });

    const throttleAlarm = new cloudwatch.Alarm(this, 'ApiThrottleAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ApiGateway',
        metricName: 'Count',
        statistic: 'Sum',
        period: cdk.Duration.minutes(1),
        dimensions: {
          ApiName: api.restApiName,
          Stage: this.node.tryGetContext('environment') || 'prod',
        },
      }),
      threshold: 1000,
      evaluationPeriods: 1,
      alarmName: 'RWA-API-Throttled',
    });

    // ────────────────────────────────────────────────────────────────
    // Outputs
    // ────────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: api.url,
      description: 'API Gateway endpoint URL',
      exportName: 'RwaApiEndpoint',
    });

    new cdk.CfnOutput(this, 'WafWebAclArn', {
      value: webAcl.attrArn,
      description: 'WAF Web ACL ARN',
      exportName: 'RwaWafWebAclArn',
    });
  }
}

// ────────────────────────────────────────────────────────────────
// CDK App
// ────────────────────────────────────────────────────────────────
const app = new cdk.App();

new RwaApiGatewayStack(app, 'RwaApiGatewayStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  description: 'RWA Marketplace API Gateway Infrastructure',
});

app.synth();
