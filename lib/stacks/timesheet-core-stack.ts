import {
  CfnOutput,
  Duration,
  Stack,
  StackProps,
  RemovalPolicy,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Runtime, Architecture, Tracing } from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';

export interface TimesheetCoreStackProps extends StackProps {
  domainName: string;
  hostedZoneId: string;
  certificateArn: string;
}

export class TimesheetCoreStack extends Stack {
  constructor(scope: Construct, id: string, props: TimesheetCoreStackProps) {
    super(scope, id, props);

    // Get the Timesheet API URL from SSM Parameter Store
    const timesheetApiUrl = ssm.StringParameter.fromStringParameterAttributes(
      this,
      'TimesheetApiUrl',
      {
        parameterName: 'timesheet-core',
      }
    );

    // Create DynamoDB table for job tracking
    const jobTable = new dynamodb.Table(this, 'TimesheetJobTable', {
      partitionKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY, // Change to RETAIN for production
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl', // Optional: auto-delete old jobs after 7 days
    });

    // Create Dead Letter Queue for failed messages
    const deadLetterQueue = new sqs.Queue(this, 'TimesheetDLQ', {
      queueName: 'timesheet-dlq',
      retentionPeriod: Duration.days(4),
    });

    // Create SQS Queue for ticket processing
    const ticketQueue = new sqs.Queue(this, 'TimesheetTicketQueue', {
      queueName: 'timesheet-ticket-queue',
      visibilityTimeout: Duration.seconds(120), // Should be >= Lambda timeout
      receiveMessageWaitTime: Duration.seconds(20), // Long polling
      deadLetterQueue: {
        queue: deadLetterQueue,
        maxReceiveCount: 2, // Retry 2 times before sending to DLQ
      },
    });

    // TODO: Remove legacy Lambda and endpoint after confirming new SQS-based architecture is stable
    // Legacy endpoint kept for backwards compatibility during migration period
    // Estimated removal date: Q1 2026 (after 2-3 months of monitoring new architecture)

    // const logGroup = new logs.LogGroup(this, 'TimesheetCoreLambdaLogGroup', {
    //   retention: logs.RetentionDays.ONE_MONTH,
    // });

    // Legacy Lambda (keep for backwards compatibility during migration)
    // const timesheetCoreLambda = new lambda.NodejsFunction(
    //   this,
    //   'TimesheetCoreLambda',
    //   {
    //     entry: path.join(
    //       __dirname,
    //       '../../resources/lambda/timesheet-core-lambda/index.ts'
    //     ),
    //     handler: 'handler',
    //     runtime: Runtime.NODEJS_20_X,
    //     architecture: Architecture.ARM_64,
    //     timeout: Duration.minutes(15),
    //     memorySize: 256,
    //     logGroup: logGroup,
    //     tracing: Tracing.DISABLED,
    //     environment: {
    //       NODE_OPTIONS: '--enable-source-maps',
    //     },
    //   }
    // );

    // Job Creator Lambda
    const jobCreatorLambda = new lambda.NodejsFunction(
      this,
      'JobCreatorLambda',
      {
        entry: path.join(
          __dirname,
          '../../resources/lambda/job-creator-lambda/index.ts'
        ),
        handler: 'handler',
        runtime: Runtime.NODEJS_20_X,
        architecture: Architecture.ARM_64,
        timeout: Duration.seconds(30),
        memorySize: 512,
        logGroup: new logs.LogGroup(this, 'JobCreatorLambdaLogGroup', {
          retention: logs.RetentionDays.ONE_MONTH,
        }),
        tracing: Tracing.ACTIVE,
        environment: {
          NODE_OPTIONS: '--enable-source-maps',
          QUEUE_URL: ticketQueue.queueUrl,
          TABLE_NAME: jobTable.tableName,
        },
      }
    );

    // Ticket Worker Lambda
    const ticketWorkerLambda = new lambda.NodejsFunction(
      this,
      'TicketWorkerLambda',
      {
        entry: path.join(
          __dirname,
          '../../resources/lambda/ticket-worker-lambda/index.ts'
        ),
        handler: 'handler',
        runtime: Runtime.NODEJS_20_X,
        architecture: Architecture.ARM_64,
        timeout: Duration.seconds(60),
        memorySize: 256,
        logGroup: new logs.LogGroup(this, 'TicketWorkerLambdaLogGroup', {
          retention: logs.RetentionDays.ONE_MONTH,
        }),
        tracing: Tracing.ACTIVE,
        environment: {
          NODE_OPTIONS: '--enable-source-maps',
          TABLE_NAME: jobTable.tableName,
        },
        // reservedConcurrentExecutions: 5, // Uncomment and adjust if you need to limit concurrent executions to avoid rate limiting
      }
    );

    // Job Status Lambda
    const jobStatusLambda = new lambda.NodejsFunction(this, 'JobStatusLambda', {
      entry: path.join(
        __dirname,
        '../../resources/lambda/job-status-lambda/index.ts'
      ),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(10),
      memorySize: 256,
      logGroup: new logs.LogGroup(this, 'JobStatusLambdaLogGroup', {
        retention: logs.RetentionDays.ONE_MONTH,
      }),
      tracing: Tracing.ACTIVE,
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        TABLE_NAME: jobTable.tableName,
      },
    });

    // Grant permissions
    ticketQueue.grantSendMessages(jobCreatorLambda);
    jobTable.grantWriteData(jobCreatorLambda);
    jobTable.grantReadWriteData(ticketWorkerLambda);
    jobTable.grantReadData(jobStatusLambda);

    // Grant the Lambda functions permission to read the parameter
    // timesheetApiUrl.grantRead(timesheetCoreLambda);
    timesheetApiUrl.grantRead(ticketWorkerLambda);

    // Configure SQS as event source for worker Lambda
    ticketWorkerLambda.addEventSource(
      new SqsEventSource(ticketQueue, {
        batchSize: 10, // Process up to 10 messages at a time
        maxBatchingWindow: Duration.seconds(5),
        reportBatchItemFailures: true, // Enable partial batch responses
      })
    );

    // Configure API Gateway with better CORS settings for CloudFront
    const api = new apigateway.RestApi(this, 'TimesheetCoreApi', {
      restApiName: 'Timesheet Service',
      description: 'This service captures Timesheet.',
      deployOptions: {
        stageName: 'prod', // Use versioned API stage
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

    // TODO: Remove legacy endpoint after migration is complete (Q1 2026)
    // Legacy endpoint (keep for backwards compatibility during migration)
    // const timesheetCoreResource = api.root.addResource('timesheet');
    // const timesheetCoreIntegration = new apigateway.LambdaIntegration(
    //   timesheetCoreLambda
    // );
    // timesheetCoreResource.addMethod('POST', timesheetCoreIntegration);

    // New endpoints for SQS Fan-Out architecture
    // POST /jobs - Create a new job
    const jobsResource = api.root.addResource('jobs');
    const jobCreatorIntegration = new apigateway.LambdaIntegration(
      jobCreatorLambda
    );
    jobsResource.addMethod('POST', jobCreatorIntegration);

    // GET /jobs/status?jobId=xxx - Get job status
    const jobStatusResource = jobsResource.addResource('status');
    const jobStatusIntegration = new apigateway.LambdaIntegration(
      jobStatusLambda
    );
    jobStatusResource.addMethod('GET', jobStatusIntegration);

    // Import existing certificate for CloudFront (must be in us-east-1)
    const certificate = acm.Certificate.fromCertificateArn(
      this,
      'TimesheetCoreCertificate',
      props.certificateArn
    );

    // Create CloudFront distribution for API
    const distribution = new cloudfront.Distribution(
      this,
      'TimesheetCoreApiDistribution',
      {
        domainNames: [props.domainName],
        certificate,
        defaultBehavior: {
          origin: new origins.RestApiOrigin(api),
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED, // API responses should not be cached by default
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      }
    );

    // Create Route53 alias record for the CloudFront distribution
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
      this,
      'TimesheetCoreHostedZone',
      {
        hostedZoneId: props.hostedZoneId,
        zoneName: props.domainName,
      }
    );

    // Create A record for the API subdomain
    new route53.ARecord(this, 'TimesheetCoreApiAliasRecord', {
      recordName: props.domainName,
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution)
      ),
      zone: hostedZone,
    });

    new CfnOutput(this, 'ApiCloudFrontUrlOutput', {
      value: distribution.distributionDomainName,
      description: 'The CloudFront URL for the API',
    });

    new CfnOutput(this, 'JobTableNameOutput', {
      value: jobTable.tableName,
      description: 'DynamoDB table name for job tracking',
    });

    new CfnOutput(this, 'TicketQueueUrlOutput', {
      value: ticketQueue.queueUrl,
      description: 'SQS queue URL for ticket processing',
    });
  }
}
