import { CfnOutput, Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
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
 *
 * Prerequisites:
 * - BaseApiStack must be deployed first
 *
 * Proxy Endpoints (single Lambda):
 * - GET /timesheet/auth - Check authentication with Jira
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
 * - POST /timesheet/projects - Fetch issues using payload
 * - GET /timesheet/projects/{projectId}/issues - Fetch issues for a project
 * - GET /timesheet/issue/{issueId} - Fetch a specific Jira issue
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

    // --- Proxy routes (all point to single TimesheetProxyLambda) ---
    // GET /timesheet/auth
    timesheetResource.addResource('auth').addMethod('GET', proxyIntegration);

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

    // GET /timesheet/issue/{issueId}
    timesheetResource
      .addResource('issue')
      .addResource('{issueId}')
      .addMethod('GET', proxyIntegration);

    // GET /timesheet/projects
    // GET /timesheet/projects/{projectId}
    const projectsResource = timesheetResource.addResource('projects');
    projectsResource.addMethod('GET', proxyIntegration);
    projectsResource.addMethod('POST', proxyIntegration);
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
  }
}
