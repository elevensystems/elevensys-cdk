import { CfnOutput, Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import * as fs from 'fs';

export interface JiraTimesheetUiStackProps extends StackProps {
  // Absolute or relative path to a pre-built static Next.js export (e.g. "out"). If provided and exists, it will be uploaded.
  siteDir?: string;
}

export class JiraTimesheetUiStack extends Stack {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

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

    // CloudFront distribution
    this.distribution = new cloudfront.Distribution(
      this,
      'JiraTimesheetSiteDistribution',
      {
        defaultRootObject: 'index.html',
        defaultBehavior: {
          origin: origins.S3BucketOrigin.withOriginAccessIdentity(this.bucket, {
            originAccessIdentity: oai,
          }),
          // viewerProtocolPolicy:
          //   cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          // cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          // responseHeadersPolicy:
          //   cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        },
      }
    );

    // Optional: deploy site assets if the directory is provided and exists
    const resolvedSiteDir = props.siteDir
      ? path.resolve(
          this.node.tryGetContext('cwd') ?? process.cwd(),
          props.siteDir
        )
      : undefined;

    if (resolvedSiteDir && fs.existsSync(resolvedSiteDir)) {
      new s3deploy.BucketDeployment(this, 'DeployJiraTimesheetSite', {
        sources: [s3deploy.Source.asset(resolvedSiteDir)],
        destinationBucket: this.bucket,
        distribution: this.distribution,
        distributionPaths: ['/*'],
        prune: true,
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
  }
}
