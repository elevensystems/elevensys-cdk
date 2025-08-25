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
  domainName?: string;
  hostedZoneId?: string;
  certificateArn?: string; // ARN of the certificate from the CertificateStack
}

export class JiraTimesheetUiStack extends Stack {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;
  public readonly certificate?: acm.ICertificate;

  constructor(
    scope: Construct,
    id: string,
    props: JiraTimesheetUiStackProps = {}
  ) {
    super(scope, id, props);

    this.bucket = new s3.Bucket(this, 'JiraTimesheetSiteBucket', {
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
    this.bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [this.bucket.arnForObjects('*')],
        principals: [
          new iam.CanonicalUserPrincipal(
            oai.cloudFrontOriginAccessIdentityS3CanonicalUserId
          ),
        ],
      })
    );

    // Certificate for custom domain
    let certificate;
    let domainNames: string[] = [];

    if (props?.domainName && props?.certificateArn) {
      // Import the certificate created in the us-east-1 region by the CertificateStack
      certificate = acm.Certificate.fromCertificateArn(
        this,
        'JiraTimesheetSiteCertificate',
        props.certificateArn
      );

      this.certificate = certificate;
      domainNames = [props.domainName];
    }

    // CloudFront distribution
    this.distribution = new cloudfront.Distribution(
      this,
      'JiraTimesheetSiteDistribution',
      {
        defaultRootObject: 'index.html',
        domainNames,
        certificate,
        defaultBehavior: {
          origin: origins.S3BucketOrigin.withOriginAccessIdentity(this.bucket, {
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

    // Create Route53 alias record for the CloudFront distribution
    if (props?.domainName && props?.hostedZoneId) {
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
          new targets.CloudFrontTarget(this.distribution)
        ),
        zone: hostedZone,
      });
    }

    new CfnOutput(this, 'StaticSiteBucketName', {
      value: this.bucket.bucketName,
      description: 'S3 bucket name hosting the static site',
    });

    new CfnOutput(this, 'CloudFrontDistributionId', {
      value: this.distribution.distributionId,
      description: 'CloudFront distribution ID',
    });

    new CfnOutput(this, 'CloudFrontDomainName', {
      value: this.distribution.domainName,
      description: 'CloudFront distribution domain name',
    });

    if (props?.domainName) {
      new CfnOutput(this, 'CustomDomainName', {
        value: props.domainName,
        description: 'Custom domain name for the site',
      });
    }
  }
}
