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
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Runtime, Architecture, Tracing } from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';

/**
 * TimesheetCoreStack - Timesheet Processing Service
 *
 * This stack adds /timesheet endpoints to the base API Gateway.
 * Endpoint: https://api.elevensys.dev/timesheet
 *
 * Architecture:
 * - 3 Lambda Functions (Job Creator, Ticket Worker, Job Status)
 * - SQS Queue for asynchronous ticket processing
 * - DynamoDB Table for job tracking
 * - Dead Letter Queue for failed messages
 *
 * Prerequisites:
 * - BaseApiStack must be deployed first
 *
 * Endpoints:
 * - POST /timesheet/jobs - Create a new job
 * - GET /timesheet/jobs/status?jobId=xxx - Get job status
 */
export interface TimesheetCoreStackProps extends StackProps {
  api: apigateway.RestApi; // Base API Gateway from BaseApiStack
  baseApiUrl: string; // Base API URL (e.g., 'https://api.elevensys.dev')
}

export class TimesheetCoreStack extends Stack {
  constructor(scope: Construct, id: string, props: TimesheetCoreStackProps) {
    super(scope, id, props);

    const jobTable = new dynamodb.Table(this, 'TimesheetJobTable', {
      partitionKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl',
    });

    const deadLetterQueue = new sqs.Queue(this, 'TimesheetDLQ', {
      queueName: 'timesheet-dlq',
      retentionPeriod: Duration.days(4),
    });

    const ticketQueue = new sqs.Queue(this, 'TimesheetTicketQueue', {
      queueName: 'timesheet-ticket-queue',
      visibilityTimeout: Duration.minutes(12),
      receiveMessageWaitTime: Duration.seconds(20),
      deadLetterQueue: {
        queue: deadLetterQueue,
        maxReceiveCount: 2,
      },
    });

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
        timeout: Duration.minutes(10),
        memorySize: 256,
        logGroup: new logs.LogGroup(this, 'TicketWorkerLambdaLogGroup', {
          retention: logs.RetentionDays.ONE_MONTH,
        }),
        tracing: Tracing.ACTIVE,
        environment: {
          NODE_OPTIONS: '--enable-source-maps',
          TABLE_NAME: jobTable.tableName,
        },
      }
    );

    const jobStatusLambda = new lambda.NodejsFunction(this, 'JobStatusLambda', {
      entry: path.join(
        __dirname,
        '../../resources/lambda/job-status-lambda/index.ts'
      ),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(15),
      memorySize: 256,
      logGroup: new logs.LogGroup(this, 'JobStatusLambdaLogGroup', {
        retention: logs.RetentionDays.ONE_MONTH,
      }),
      tracing: Tracing.ACTIVE,
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        TABLE_NAME: jobTable.tableName,
      },
      // reservedConcurrentExecutions: 5, // Limit concurrent executions to prevent 429 errors
    });

    ticketQueue.grantSendMessages(jobCreatorLambda);
    jobTable.grantWriteData(jobCreatorLambda);
    jobTable.grantReadWriteData(ticketWorkerLambda);
    jobTable.grantReadData(jobStatusLambda);

    ticketWorkerLambda.addEventSource(
      new SqsEventSource(ticketQueue, {
        batchSize: 10,
        maxBatchingWindow: Duration.seconds(3),
        reportBatchItemFailures: true,
      })
    );

    const timesheetResource = props.api.root.addResource('timesheet');

    const jobsResource = timesheetResource.addResource('jobs');
    const jobCreatorIntegration = new apigateway.LambdaIntegration(
      jobCreatorLambda
    );
    jobsResource.addMethod('POST', jobCreatorIntegration);

    const jobStatusResource = jobsResource.addResource('status');
    const jobStatusIntegration = new apigateway.LambdaIntegration(
      jobStatusLambda
    );
    jobStatusResource.addMethod('GET', jobStatusIntegration);

    new CfnOutput(this, 'TimesheetApiUrlOutput', {
      value: `${props.baseApiUrl}/timesheet`,
      description: 'Timesheet API endpoint URL',
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
