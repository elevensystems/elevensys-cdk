import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';

export interface JiraTimesheetUiStackProps extends StackProps {
  domainName: string;
  hostedZoneId: string;
  certificateArn: string; // ARN of the certificate from the CertificateStack
}

export class JiraTimesheetUiStack extends Stack {
  constructor(scope: Construct, id: string, props: JiraTimesheetUiStackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, 'JiraTimesheetSiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      publicReadAccess: false,
      websiteIndexDocument: 'index.html',
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      // enforceSSL: true,
      // versioned for safe rollbacks; adjust as needed
      // versioned: true,
    });

    // Use Origin Access Identity for simplicity and broad CDK support
    const oai = new cloudfront.OriginAccessIdentity(
      this,
      'JiraTimesheetSiteOAI'
    );
    bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [bucket.arnForObjects('*')],
        principals: [
          new iam.CanonicalUserPrincipal(
            oai.cloudFrontOriginAccessIdentityS3CanonicalUserId
          ),
        ],
      })
    );

    const certificate = acm.Certificate.fromCertificateArn(
      this,
      'JiraTimesheetSiteCertificate',
      props.certificateArn
    );

    // CloudFront distribution
    const distribution = new cloudfront.Distribution(
      this,
      'JiraTimesheetSiteDistribution',
      {
        defaultRootObject: 'index.html',
        domainNames: [props.domainName],
        certificate,
        defaultBehavior: {
          origin: origins.S3BucketOrigin.withOriginAccessIdentity(bucket, {
            originAccessIdentity: oai,
          }),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          // responseHeadersPolicy:
          //   cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        },
        errorResponses: [
          {
            httpStatus: 404,
            responseHttpStatus: 404,
            responsePagePath: '/404.html',
            ttl: Duration.minutes(30),
          },
        ],
      }
    );

    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
      this,
      'JiraTimesheetHostedZoneAlias',
      {
        hostedZoneId: props.hostedZoneId,
        zoneName: props.domainName,
      }
    );

    new route53.ARecord(this, 'JiraTimesheetSiteAliasRecord', {
      recordName: props.domainName,
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution)
      ),
      zone: hostedZone,
    });

    new CfnOutput(this, 'StaticSiteBucketName', {
      value: bucket.bucketName,
      description: 'S3 bucket name hosting the static site',
    });

    new CfnOutput(this, 'CloudFrontDistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront distribution ID',
    });

    new CfnOutput(this, 'CloudFrontDomainName', {
      value: distribution.domainName,
      description: 'CloudFront distribution domain name',
    });

    new CfnOutput(this, 'CustomDomainName', {
      value: props.domainName,
      description: 'Custom domain name for the site',
    });
  }
}
