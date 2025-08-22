import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Runtime, Architecture, Tracing } from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';

export class JiraTimesheetCaptureStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Get the Jira API URL from SSM Parameter Store
    const jiraApiUrl = ssm.StringParameter.fromStringParameterAttributes(
      this,
      'JiraApiUrl',
      {
        parameterName: '/jira-timesheet/api-url',
      }
    );

    // Create DynamoDB table for tickets
    const ticketsTable = new dynamodb.Table(this, 'TicketsTable', {
      partitionKey: { name: 'ticketId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY, // Change to RETAIN for production
    });

    const logGroup = new logs.LogGroup(this, 'JiraTimesheetLambdaLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
    });

    const jiraTimesheetLambda = new lambda.NodejsFunction(
      this,
      'JiraTimesheetLambda',
      {
        entry: path.join(
          __dirname,
          '../../resources/lambda/jira-timesheet-lambda/index.ts'
        ),
        handler: 'handler',
        runtime: Runtime.NODEJS_20_X,
        architecture: Architecture.ARM_64,
        timeout: Duration.seconds(15),
        memorySize: 256,
        logGroup: logGroup,
        tracing: Tracing.DISABLED,
        bundling: {
          externalModules: [
            'aws-sdk', // Exclude AWS SDK from bundling
          ],
        },
        environment: {
          NODE_OPTIONS: '--enable-source-maps', // Best practice for debugging
          TICKETS_TABLE_NAME: ticketsTable.tableName, // Pass the table name to the Lambda function
        },
      }
    );

    // Create a new Lambda function for ticket CRUD operations
    const ticketCrudLambda = new lambda.NodejsFunction(
      this,
      'TicketCrudLambda',
      {
        entry: path.join(
          __dirname,
          '../../resources/lambda/ticket-crud-lambda/index.ts'
        ),
        handler: 'handler',
        runtime: Runtime.NODEJS_20_X,
        architecture: Architecture.ARM_64,
        timeout: Duration.seconds(15),
        memorySize: 256,
        logGroup: new logs.LogGroup(this, 'TicketCrudLambdaLogGroup', {
          retention: logs.RetentionDays.ONE_MONTH,
        }),
        tracing: Tracing.DISABLED,
        bundling: {
          externalModules: [
            'aws-sdk', // Exclude AWS SDK from bundling
          ],
        },
        environment: {
          NODE_OPTIONS: '--enable-source-maps',
          TICKETS_TABLE_NAME: ticketsTable.tableName,
        },
      }
    );

    // Grant the Lambda functions permission to read the parameter
    jiraApiUrl.grantRead(jiraTimesheetLambda);

    // Grant the Lambda function permission to read from the DynamoDB table
    ticketsTable.grantReadData(jiraTimesheetLambda);

    // Grant the ticket CRUD Lambda function full access to the tickets table
    ticketsTable.grantReadWriteData(ticketCrudLambda);

    const api = new apigateway.RestApi(this, 'JiraTimesheetApi', {
      restApiName: 'Jira Timesheet Service',
      description: 'This service captures Jira timesheets.',
      deployOptions: {
        tracingEnabled: true, // Enable X-Ray tracing
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    const timesheetResource = api.root.addResource('timesheet');
    const jiraIntegration = new apigateway.LambdaIntegration(
      jiraTimesheetLambda
    );

    timesheetResource.addMethod('POST', jiraIntegration); // Consider adding an authorizer for production

    // Create ticket resource and methods for CRUD operations
    const ticketsResource = api.root.addResource('tickets');
    const ticketIntegration = new apigateway.LambdaIntegration(
      ticketCrudLambda
    );

    // GET /tickets - List all tickets
    ticketsResource.addMethod('GET', ticketIntegration);

    // POST /tickets - Create a new ticket
    ticketsResource.addMethod('POST', ticketIntegration);

    // Set up individual ticket operations with path parameter
    const ticketResource = ticketsResource.addResource('{ticketId}');

    // GET /tickets/{ticketId} - Get a ticket by ID
    ticketResource.addMethod('GET', ticketIntegration);

    // PUT /tickets/{ticketId} - Update a ticket
    ticketResource.addMethod('PUT', ticketIntegration);

    // DELETE /tickets/{ticketId} - Delete a ticket
    ticketResource.addMethod('DELETE', ticketIntegration);

    new CfnOutput(this, 'ApiUrlOutput', {
      value: api.url,
      description: 'The URL of the API Gateway endpoint',
    });

    new CfnOutput(this, 'TicketsTableName', {
      value: ticketsTable.tableName,
      description: 'The name of the DynamoDB table for tickets',
    });
  }
}
