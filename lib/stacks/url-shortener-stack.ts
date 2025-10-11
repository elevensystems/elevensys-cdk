import { Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Architecture, Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export class UrlShortenerStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create DynamoDB table for URL mappings
    const urlShortenerTable = new dynamodb.Table(this, 'UrlShortenerTable', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY, // Change to RETAIN for production
      timeToLiveAttribute: 'TTL', // Enable TTL for auto-deletion
    });

    // Create CloudWatch Log Group for the Lambda function
    const logGroup = new logs.LogGroup(this, 'UrlShortenerLambdaLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
    });

    // Create Lambda function for URL shortening
    const urlShortenerLambda = new lambda.NodejsFunction(
      this,
      'UrlShortenerLambda',
      {
        runtime: Runtime.NODEJS_LATEST,
        architecture: Architecture.ARM_64,
        timeout: Duration.seconds(15),
        memorySize: 128,
        tracing: Tracing.DISABLED,
        logGroup: logGroup,
        environment: {
          NODE_OPTIONS: '--enable-source-maps', // Best practice for debugging
          URL_SHORTENER_TABLE_NAME: urlShortenerTable.tableName, // Pass the table name to the Lambda function
        },
      }
    );

    const api = new apigateway.RestApi(this, 'UrlShortenerApi', {
      restApiName: 'Url Shortener Service',
      description: 'The service shortens URLs.',
      deployOptions: {
        stageName: 'prod',
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
        maxAge: Duration.days(1),
      },
    });

    const lambdaIntegration = new apigateway.LambdaIntegration(
      urlShortenerLambda
    );

    // /api resource
    const apiResource = api.root.addResource('api');

    // POST /api/shorten - Create shortened URL
    const shortenResource = apiResource.addResource('shorten');
    shortenResource.addMethod('POST', lambdaIntegration);

    // GET /api/stats/:shortCode - Get URL statistics
    const statsResource = apiResource.addResource('stats');
    const statsShortCodeResource = statsResource.addResource('{shortCode}');
    statsShortCodeResource.addMethod('GET', lambdaIntegration);

    // GET /api/urls - List all URLs (paginated)
    const urlsResource = apiResource.addResource('urls');
    urlsResource.addMethod('GET', lambdaIntegration);

    // DELETE /api/url/:shortCode - Delete a shortened URL
    const urlResource = apiResource.addResource('url');
    const urlShortCodeResource = urlResource.addResource('{shortCode}');
    urlShortCodeResource.addMethod('DELETE', lambdaIntegration);

    // GET /:shortCode - Redirect to original URL
    const shortCodeResource = api.root.addResource('{shortCode}');
    shortCodeResource.addMethod('GET', lambdaIntegration);

    // GET /health - Health check
    const healthResource = api.root.addResource('health');
    healthResource.addMethod('GET', lambdaIntegration);

    // Grant the Lambda function read/write permissions to the DynamoDB table
    urlShortenerTable.grantReadWriteData(urlShortenerLambda);
  }
}
