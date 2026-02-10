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
 * - 1 Proxy Lambda (handles all Jira API proxy routes)
 * - 3 Legacy Lambda Functions (Job Creator, Ticket Worker, Job Status) - REDUNDANT, planned for removal
 * - SQS Queue for asynchronous ticket processing (legacy)
 * - DynamoDB Table for job tracking (legacy)
 * - Dead Letter Queue for failed messages (legacy)
 *
 * Prerequisites:
 * - BaseApiStack must be deployed first
 *
 * Proxy Endpoints (single Lambda):
 * - GET /timesheet/worklogs?fromDate=x&toDate=y&user=z&jiraInstance=jiradc - Fetch user worklogs
 * - GET /timesheet/project-worklogs?fromDate=x&toDate=y&jiraInstance=jiradc - Fetch project worklogs
 * - GET /timesheet/project-worklogs/pagination?fromDate=x&toDate=y&jiraInstance=jiradc - Fetch project worklogs pagination
 * - DELETE /timesheet/project-worklogs/{issueId}/{timesheetId}?jiraInstance=jiradc - Delete timesheet entry
 * - GET /timesheet/timesheet-view?fromDate=x&toDate=y&user=z&jiraInstance=jiradc - Fetch timesheet calendar view
 * - GET /timesheet/timesheet-dates?fromDate=x&toDate=y&user=z&jiraInstance=jiradc - Fetch timesheet dates
 * - POST /timesheet/logwork?jiraInstance=jiradc - Log work entry to Jira
 * - POST /timesheet/project-worklogs-warning?jiraInstance=jiradc - Get project worklogs warning report
 * - GET /timesheet/projects?jiraInstance=jiradc - Fetch all Jira projects
 * - GET /timesheet/projects/{projectId}?jiraInstance=jiradc - Fetch a specific Jira project by ID
 * - GET /timesheet/projects/{projectId}/issues?startIndex=0&jiraInstance=jiradc - Fetch issues for a project
 *
 * Legacy Endpoints (REDUNDANT - planned for removal):
 * - POST /timesheet/jobs - Create a new job
 * - GET /timesheet/jobs/status?jobId=xxx - Get job status
 */
export interface TimesheetCoreStackProps extends StackProps {
  api: apigateway.RestApi; // Base API Gateway from BaseApiStack
  baseApiUrl: string; // Base API URL (e.g., 'https://api.elevensys.dev')
}

/** Shared Lambda defaults for all functions in this stack */
const LAMBDA_DEFAULTS = {
  handler: 'handler' as const,
  runtime: Runtime.NODEJS_20_X,
  architecture: Architecture.ARM_64,
  tracing: Tracing.ACTIVE,
  memorySize: 256,
};

export class TimesheetCoreStack extends Stack {
  constructor(scope: Construct, id: string, props: TimesheetCoreStackProps) {
    super(scope, id, props);

    // =========================================================================
    // Legacy Infrastructure (REDUNDANT - planned for removal)
    // =========================================================================

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
        ...LAMBDA_DEFAULTS,
        entry: path.join(
          __dirname,
          '../../resources/lambda/job-creator-lambda/index.ts'
        ),
        timeout: Duration.seconds(30),
        memorySize: 512,
        logGroup: new logs.LogGroup(this, 'JobCreatorLambdaLogGroup', {
          retention: logs.RetentionDays.ONE_MONTH,
        }),
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
        ...LAMBDA_DEFAULTS,
        entry: path.join(
          __dirname,
          '../../resources/lambda/ticket-worker-lambda/index.ts'
        ),
        timeout: Duration.minutes(10),
        logGroup: new logs.LogGroup(this, 'TicketWorkerLambdaLogGroup', {
          retention: logs.RetentionDays.ONE_MONTH,
        }),
        environment: {
          NODE_OPTIONS: '--enable-source-maps',
          TABLE_NAME: jobTable.tableName,
        },
      }
    );

    const jobStatusLambda = new lambda.NodejsFunction(this, 'JobStatusLambda', {
      ...LAMBDA_DEFAULTS,
      entry: path.join(
        __dirname,
        '../../resources/lambda/job-status-lambda/index.ts'
      ),
      timeout: Duration.seconds(15),
      logGroup: new logs.LogGroup(this, 'JobStatusLambdaLogGroup', {
        retention: logs.RetentionDays.ONE_MONTH,
      }),
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        TABLE_NAME: jobTable.tableName,
      },
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

    // =========================================================================
    // Timesheet Proxy Lambda (single Lambda for all Jira API routes)
    // =========================================================================

    const timesheetProxyLambda = new lambda.NodejsFunction(
      this,
      'TimesheetProxyLambda',
      {
        ...LAMBDA_DEFAULTS,
        entry: path.join(
          __dirname,
          '../../resources/lambda/timesheet-proxy-lambda/index.ts'
        ),
        timeout: Duration.seconds(30),
        logGroup: new logs.LogGroup(this, 'TimesheetProxyLambdaLogGroup', {
          retention: logs.RetentionDays.ONE_MONTH,
        }),
        environment: {
          NODE_OPTIONS: '--enable-source-maps',
        },
      }
    );

    const proxyIntegration = new apigateway.LambdaIntegration(
      timesheetProxyLambda
    );

    // =========================================================================
    // API Gateway Routes
    // =========================================================================

    const timesheetResource = props.api.root.addResource('timesheet');

    // --- Legacy routes (REDUNDANT) ---
    const jobsResource = timesheetResource.addResource('jobs');
    jobsResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(jobCreatorLambda)
    );
    jobsResource
      .addResource('status')
      .addMethod('GET', new apigateway.LambdaIntegration(jobStatusLambda));

    // --- Proxy routes (all point to single TimesheetProxyLambda) ---
    // GET /timesheet/worklogs
    timesheetResource
      .addResource('worklogs')
      .addMethod('GET', proxyIntegration);

    // GET /timesheet/project-worklogs
    // GET /timesheet/project-worklogs/pagination
    // DELETE /timesheet/project-worklogs/{issueId}/{timesheetId}
    const projectWorklogsResource =
      timesheetResource.addResource('project-worklogs');
    projectWorklogsResource.addMethod('GET', proxyIntegration);
    projectWorklogsResource
      .addResource('pagination')
      .addMethod('GET', proxyIntegration);
    const issueIdResource = projectWorklogsResource.addResource('{issueId}');
    issueIdResource
      .addResource('{timesheetId}')
      .addMethod('DELETE', proxyIntegration);

    // GET /timesheet/timesheet-view
    timesheetResource
      .addResource('timesheet-view')
      .addMethod('GET', proxyIntegration);

    // GET /timesheet/timesheet-dates
    timesheetResource
      .addResource('timesheet-dates')
      .addMethod('GET', proxyIntegration);

    // POST /timesheet/logwork
    timesheetResource
      .addResource('logwork')
      .addMethod('POST', proxyIntegration);

    // POST /timesheet/project-worklogs-warning
    timesheetResource
      .addResource('project-worklogs-warning')
      .addMethod('POST', proxyIntegration);

    // GET /timesheet/projects
    // GET /timesheet/projects/{projectId}
    const projectsResource = timesheetResource.addResource('projects');
    projectsResource.addMethod('GET', proxyIntegration);
    const projectIdResource = projectsResource.addResource('{projectId}');
    projectIdResource.addMethod('GET', proxyIntegration);
    projectIdResource.addResource('issues').addMethod('GET', proxyIntegration);

    // =========================================================================
    // Outputs
    // =========================================================================

    new CfnOutput(this, 'TimesheetApiUrlOutput', {
      value: `${props.baseApiUrl}/timesheet`,
      description: 'Timesheet API endpoint URL',
    });

    new CfnOutput(this, 'JobTableNameOutput', {
      value: jobTable.tableName,
      description: 'DynamoDB table name for job tracking (legacy)',
    });

    new CfnOutput(this, 'TicketQueueUrlOutput', {
      value: ticketQueue.queueUrl,
      description: 'SQS queue URL for ticket processing (legacy)',
    });
  }
}
