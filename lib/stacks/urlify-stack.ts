import { Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Architecture, Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import path from 'path';

/**
 * UrlifyStack - URL Shortener Service
 *
 * This stack provides URL shortening with 2 separate endpoints:
 *
 * Architecture:
 * - Admin API (api.elevensys.dev/urlify): Manage URLs (create, view, delete)
 * - Redirect API (urlify.cc): Redirect shortened URLs
 *
 * Components:
 * - 2 Lambda Functions (Admin & Redirect)
 * - 1 DynamoDB Table (shared storage)
 * - Admin API uses base API Gateway (api.elevensys.dev)
 * - Redirect API has separate API Gateway + CloudFront
 * - SSL Certificate for redirect domain
 * - Route53 Records (DNS configuration)
 *
 * Caching Strategy:
 * - Admin API: No cache (inherited from base API)
 * - Redirect API: 5 min cache - optimized performance
 *
 * Prerequisites:
 * - ACM Certificate in us-east-1 for urlify.cc
 * - Route53 Hosted Zone for urlify.cc
 * - BaseApiStack must be deployed first
 *
 * See: URLIFY_SETUP.md
 */
export interface UrlifyStackProps extends StackProps {
  redirectDomain: string;
  hostedZoneId: string;
  certificateArn: string;
  api: apigateway.RestApi;
  baseApiUrl: string;
}

export class UrlifyStack extends Stack {
  constructor(scope: Construct, id: string, props: UrlifyStackProps) {
    super(scope, id, props);

    const urlifyTable = new dynamodb.Table(this, 'UrlifyTable', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'TTL',
    });

    const adminLogGroup = new logs.LogGroup(this, 'UrlifyAdminLambdaLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
    });

    const redirectLogGroup = new logs.LogGroup(
      this,
      'UrlifyRedirectLambdaLogGroup',
      {
        retention: logs.RetentionDays.ONE_MONTH,
      }
    );

    const urlifyAdminLambda = new lambda.NodejsFunction(
      this,
      'UrlifyAdminLambda',
      {
        entry: path.join(
          __dirname,
          '../../resources/lambda/urlify-admin-lambda/index.ts'
        ),
        runtime: Runtime.NODEJS_LATEST,
        architecture: Architecture.ARM_64,
        timeout: Duration.seconds(15),
        memorySize: 128,
        tracing: Tracing.DISABLED,
        logGroup: adminLogGroup,
        environment: {
          NODE_OPTIONS: '--enable-source-maps',
          URLIFY_TABLE_NAME: urlifyTable.tableName,
          BASE_URL: `https://${props.redirectDomain}`,
        },
      }
    );

    const urlifyLambda = new lambda.NodejsFunction(this, 'UrlifyLambda', {
      entry: path.join(
        __dirname,
        '../../resources/lambda/urlify-lambda/index.ts'
      ),
      runtime: Runtime.NODEJS_LATEST,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(15),
      memorySize: 128,
      tracing: Tracing.DISABLED,
      logGroup: redirectLogGroup,
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        URLIFY_TABLE_NAME: urlifyTable.tableName,
      },
    });

    // ===== Admin API on Base API Gateway (api.elevensys.dev/urlify) =====
    const urlifyAdminLambdaIntegration = new apigateway.LambdaIntegration(
      urlifyAdminLambda
    );

    const urlifyResource = props.api.root.addResource('urlify');

    const healthResource = urlifyResource.addResource('health');
    healthResource.addMethod('GET', urlifyAdminLambdaIntegration);

    const shortenResource = urlifyResource.addResource('shorten');
    shortenResource.addMethod('POST', urlifyAdminLambdaIntegration);

    const statsResource = urlifyResource.addResource('stats');
    const statsShortCodeResource = statsResource.addResource('{shortCode}');
    statsShortCodeResource.addMethod('GET', urlifyAdminLambdaIntegration);

    const urlsResource = urlifyResource.addResource('urls');
    urlsResource.addMethod('GET', urlifyAdminLambdaIntegration);

    const urlResource = urlifyResource.addResource('url');
    const urlShortCodeResource = urlResource.addResource('{shortCode}');
    urlShortCodeResource.addMethod('DELETE', urlifyAdminLambdaIntegration);

    const redirectApi = new apigateway.RestApi(this, 'UrlifyRedirectApi', {
      restApiName: 'Urlify Redirect Service',
      description: 'Handles URL redirects.',
      deployOptions: {
        stageName: 'prod',
      },
    });

    const urlifyLambdaIntegration = new apigateway.LambdaIntegration(
      urlifyLambda
    );

    const shortCodeResource = redirectApi.root.addResource('{shortCode}');
    shortCodeResource.addMethod('GET', urlifyLambdaIntegration);

    urlifyTable.grantReadWriteData(urlifyAdminLambda);
    urlifyTable.grantReadWriteData(urlifyLambda);
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
      this,
      'HostedZone',
      {
        hostedZoneId: props.hostedZoneId,
        zoneName: props.redirectDomain,
      }
    );

    const certificate = acm.Certificate.fromCertificateArn(
      this,
      'UrlifySSLCertificate',
      props.certificateArn
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
          cachePolicy: new cloudfront.CachePolicy(
            this,
            'UrlifyRedirectCachePolicy',
            {
              cachePolicyName: 'UrlifyRedirectCachePolicy',
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
