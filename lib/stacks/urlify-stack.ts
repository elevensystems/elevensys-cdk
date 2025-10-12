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
 * Tạo hệ thống rút gọn URL hoàn chỉnh với 2 domains riêng biệt:
 *
 * Architecture:
 * - Admin API (api.urlify.cc): Quản lý URLs (tạo, xem, xóa)
 * - Redirect API (urlify.cc): Chuyển hướng URL rút gọn
 *
 * Components:
 * - 2 API Gateways (Admin & Redirect)
 * - 2 Lambda Functions (Admin & Redirect)
 * - 1 DynamoDB Table (shared storage)
 * - 2 CloudFront Distributions (CDN + SSL)
 * - SSL Certificate (existing ACM certificate required)
 * - Route53 Records (DNS configuration)
 *
 * Caching Strategy:
 * - Admin API: No cache (TTL=0) - realtime data
 * - Redirect API: 5 min cache - tối ưu hiệu suất
 *
 * Prerequisites:
 * - ACM Certificate in us-east-1 covering both domains (urlify.cc, *.urlify.cc)
 * - Route53 Hosted Zone for the domain
 *
 * Xem thêm: URLIFY_SETUP.md
 */
export interface UrlifyStackProps extends StackProps {
  redirectDomain: string; // e.g., 'urlify.cc' - for URL redirects
  adminDomain: string; // e.g., 'api.urlify.cc' - for admin API
  hostedZoneId: string; // Route53 Hosted Zone ID
  certificateArn: string; // ARN of ACM certificate (must be in us-east-1, covering both domains)
}

export class UrlifyStack extends Stack {
  constructor(scope: Construct, id: string, props: UrlifyStackProps) {
    super(scope, id, props);

    // Create DynamoDB table for URL mappings
    const urlifyTable = new dynamodb.Table(this, 'UrlifyTable', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY, // Change to RETAIN for production
      timeToLiveAttribute: 'TTL', // Enable TTL for auto-deletion
    });

    // Create CloudWatch Log Groups for the Lambda functions
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

    // Create Admin Lambda function for URL shortening
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
          NODE_OPTIONS: '--enable-source-maps', // Best practice for debugging
          URLIFY_TABLE_NAME: urlifyTable.tableName, // Pass the table name to the Lambda function
          BASE_URL: `https://${props.redirectDomain}`, // Base URL for shortened links
        },
      }
    );

    // Create Lambda function for URL redirection
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

    // ===== Admin API Gateway (api.urlify.cc) =====
    const adminApi = new apigateway.RestApi(this, 'UrlifyAdminApi', {
      restApiName: 'Urlify Admin Service',
      description: 'Admin API for URL shortening management.',
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

    const urlifyAdminLambdaIntegration = new apigateway.LambdaIntegration(
      urlifyAdminLambda
    );

    // GET /health - Health check
    const healthResource = adminApi.root.addResource('health');
    healthResource.addMethod('GET', urlifyAdminLambdaIntegration);

    // POST /shorten - Create shortened URL
    const shortenResource = adminApi.root.addResource('shorten');
    shortenResource.addMethod('POST', urlifyAdminLambdaIntegration);

    // GET /stats/:shortCode - Get URL statistics
    const statsResource = adminApi.root.addResource('stats');
    const statsShortCodeResource = statsResource.addResource('{shortCode}');
    statsShortCodeResource.addMethod('GET', urlifyAdminLambdaIntegration);

    // GET /urls - List all URLs (paginated)
    const urlsResource = adminApi.root.addResource('urls');
    urlsResource.addMethod('GET', urlifyAdminLambdaIntegration);

    // DELETE /url/:shortCode - Delete a shortened URL
    const urlResource = adminApi.root.addResource('url');
    const urlShortCodeResource = urlResource.addResource('{shortCode}');
    urlShortCodeResource.addMethod('DELETE', urlifyAdminLambdaIntegration);

    // ===== Redirect API Gateway (urlify.cc) =====
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

    // GET /:shortCode - Redirect to original URL
    const shortCodeResource = redirectApi.root.addResource('{shortCode}');
    shortCodeResource.addMethod('GET', urlifyLambdaIntegration);

    // Grant the Lambda functions read/write permissions to the DynamoDB table
    urlifyTable.grantReadWriteData(urlifyAdminLambda);
    urlifyTable.grantReadWriteData(urlifyLambda); // Needs write access to update click counts

    // ===== Route53 Hosted Zone =====
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
      this,
      'HostedZone',
      {
        hostedZoneId: props.hostedZoneId,
        zoneName: props.redirectDomain, // Base domain
      }
    );

    // ===== SSL Certificate =====
    // Import existing certificate for CloudFront (must be in us-east-1)
    const certificate = acm.Certificate.fromCertificateArn(
      this,
      'UrlifySSLCertificate',
      props.certificateArn
    );

    // ===== CloudFront Distribution for Admin API (api.urlify.cc) =====
    const adminDistribution = new cloudfront.Distribution(
      this,
      'UrlifyAdminDistribution',
      {
        comment: 'Urlify Admin API Distribution',
        domainNames: [props.adminDomain], // Custom domain: api.urlify.cc
        certificate: certificate, // SSL certificate
        defaultBehavior: {
          origin: new origins.RestApiOrigin(adminApi),
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: new cloudfront.CachePolicy(
            this,
            'UrlifyAdminCachePolicy',
            {
              cachePolicyName: 'UrlifyAdminCachePolicy',
              comment: 'Cache policy for Urlify Admin API',
              defaultTtl: Duration.seconds(0), // No caching for API endpoints
              minTtl: Duration.seconds(0),
              maxTtl: Duration.seconds(1),
              cookieBehavior: cloudfront.CacheCookieBehavior.none(),
              headerBehavior: cloudfront.CacheHeaderBehavior.allowList(
                'Authorization',
                'Content-Type',
                'Accept'
              ),
              queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
              enableAcceptEncodingGzip: true,
              enableAcceptEncodingBrotli: true,
            }
          ),
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
        priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      }
    );

    // ===== CloudFront Distribution for Redirects (urlify.cc) =====
    const redirectDistribution = new cloudfront.Distribution(
      this,
      'UrlifyRedirectDistribution',
      {
        comment: 'Urlify URL Redirect Distribution',
        domainNames: [props.redirectDomain], // Custom domain: urlify.cc
        certificate: certificate, // SSL certificate
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

    // ===== Route53 Records =====
    // Route53 A Record for admin API (api.urlify.cc)
    new route53.ARecord(this, 'UrlifyAdminAliasRecord', {
      zone: hostedZone,
      recordName: props.adminDomain,
      target: route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(adminDistribution)
      ),
    });

    // Route53 A Record for redirects (urlify.cc)
    new route53.ARecord(this, 'UrlifyRedirectAliasRecord', {
      zone: hostedZone,
      recordName: props.redirectDomain,
      target: route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(redirectDistribution)
      ),
    });
  }
}
