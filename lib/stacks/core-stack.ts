import { Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Architecture, Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import path from 'path';

export interface CoreStackProps extends StackProps {
  api: apigateway.RestApi;
  baseApiUrl: string;
  redirectDomain: string;
  urlifyHostedZoneId: string;
  urlifyCertificateArn: string;
}

export class CoreStack extends Stack {
  constructor(scope: Construct, id: string, props: CoreStackProps) {
    super(scope, id, props);

    const urlifyTable = new dynamodb.Table(this, 'UrlifyTable', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'TTL',
    });

    // SSM parameter for OpenAI API key (same path as before)
    const openaiApiKey = ssm.StringParameter.fromStringParameterName(
      this,
      'OpenAIApiKey',
      '/openai/api-key'
    );

    // Path to pre-built elevensys-core (sibling repo).
    // In CI, both repos are checked out as siblings under github.workspace,
    // so the relative path resolves correctly without any env override.
    const ELEVENSYS_CORE_PATH =
      process.env.ELEVENSYS_CORE_PATH ??
      path.resolve(__dirname, '../../../elevensys-core');

    const logGroup = new logs.LogGroup(this, 'CoreLambdaLogGroup', {
      retention: RetentionDays.ONE_MONTH,
    });

    const coreLambda = new lambda.Function(this, 'CoreLambda', {
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      // SWC strips leading paths: src/lambda.ts → dist/lambda.js
      handler: 'dist/lambda.handler',
      code: lambda.Code.fromAsset(ELEVENSYS_CORE_PATH, {
        exclude: [
          'src/**',
          'tsconfig*.json',
          '.swcrc',
          '.env*',
          '.prettierrc',
          '.prettierignore',
          '.barrels.json',
          'nodemon.json',
          'processes.config.cjs',
          'Dockerfile*',
          'docker-compose.yml',
          'scripts/**',
          'test/**',
          'coverage/**',
          '.github/**',
          '*.md',
          'AGENTS.md',
        ],
      }),
      timeout: Duration.seconds(30),
      memorySize: 512,
      tracing: Tracing.ACTIVE,
      logGroup,
      environment: {
        NODE_ENV: 'production',
        URLIFY_TABLE_NAME: urlifyTable.tableName,
        URLIFY_BASE_URL: `https://${props.redirectDomain}`,
        OPENAI_API_KEY: openaiApiKey.stringValue,
      },
    });

    urlifyTable.grantReadWriteData(coreLambda);
    openaiApiKey.grantRead(coreLambda);

    // =========================================================================
    // API Gateway: catch-all proxy routes per domain
    // Ts.ED/Koa handles internal routing once the request reaches the Lambda
    // =========================================================================
    const integration = new apigateway.LambdaIntegration(coreLambda, {
      proxy: true,
    });

    for (const prefix of ['timesheet', 'openai', 'urlify', 'r']) {
      const resource = props.api.root.addResource(prefix);
      resource.addMethod('ANY', integration);
      resource.addResource('{proxy+}').addMethod('ANY', integration);
    }

    // =========================================================================
    // Redirect domain (urlify.cc) — CloudFront + Route53
    // Mirrors the UrlifyStack setup; the CloudFront Function rewrites
    // /{shortCode} → /r/{shortCode} to match the Ts.ED redirect controller
    // =========================================================================
    const redirectApi = new apigateway.RestApi(this, 'UrlifyRedirectApi', {
      restApiName: 'Urlify Redirect Service',
      description: 'Handles URL redirects via CoreLambda.',
      deployOptions: { stageName: 'prod' },
    });

    redirectApi.root
      .addResource('{shortCode}')
      .addMethod(
        'GET',
        new apigateway.LambdaIntegration(coreLambda, { proxy: true })
      );

    const pathRewriteFn = new cloudfront.Function(this, 'RedirectPathRewrite', {
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  request.uri = '/r' + request.uri;
  return request;
}
      `),
      comment:
        'Prepend /r to redirect-domain requests before forwarding to origin',
    });

    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
      this,
      'UrlifyHostedZone',
      {
        hostedZoneId: props.urlifyHostedZoneId,
        zoneName: props.redirectDomain,
      }
    );

    const certificate = acm.Certificate.fromCertificateArn(
      this,
      'UrlifySSLCertificate',
      props.urlifyCertificateArn
    );

    const redirectDistribution = new cloudfront.Distribution(
      this,
      'UrlifyRedirectDistribution',
      {
        comment: 'Urlify URL Redirect Distribution',
        domainNames: [props.redirectDomain],
        certificate,
        defaultBehavior: {
          origin: new origins.RestApiOrigin(redirectApi),
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          functionAssociations: [
            {
              function: pathRewriteFn,
              eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            },
          ],
          cachePolicy: new cloudfront.CachePolicy(
            this,
            'UrlifyRedirectCachePolicy',
            {
              cachePolicyName: 'CoreStackUrlifyRedirectCachePolicy',
              comment: 'Cache policy for URL redirects',
              defaultTtl: Duration.minutes(5),
              minTtl: Duration.seconds(1),
              maxTtl: Duration.hours(24),
              cookieBehavior: cloudfront.CacheCookieBehavior.none(),
              headerBehavior: cloudfront.CacheHeaderBehavior.none(),
              queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
              enableAcceptEncodingGzip: true,
              enableAcceptEncodingBrotli: true,
            }
          ),
        },
        priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      }
    );

    new route53.ARecord(this, 'UrlifyRedirectAliasRecord', {
      zone: hostedZone,
      recordName: props.redirectDomain,
      target: route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(redirectDistribution)
      ),
    });
  }
}
