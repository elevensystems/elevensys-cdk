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
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';

export interface JiraTimesheetCaptureStackProps extends StackProps {
  domainName?: string;
  apiDomainPrefix?: string;
  hostedZoneId?: string;
  certificateArn?: string;
}

export class JiraTimesheetCaptureStack extends Stack {
  // Expose the API for use in other stacks
  public readonly api: apigateway.RestApi;
  public readonly distribution: cloudfront.Distribution;

  constructor(
    scope: Construct,
    id: string,
    props?: JiraTimesheetCaptureStackProps
  ) {
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

    // Configure API Gateway with better CORS settings for CloudFront
    this.api = new apigateway.RestApi(this, 'JiraTimesheetApi', {
      restApiName: 'Jira Timesheet Service',
      description: 'This service captures Jira timesheets.',
      deployOptions: {
        tracingEnabled: true, // Enable X-Ray tracing
        stageName: 'v1', // Use versioned API stage
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

    const timesheetResource = this.api.root.addResource('timesheet');
    const jiraIntegration = new apigateway.LambdaIntegration(
      jiraTimesheetLambda
    );

    timesheetResource.addMethod('POST', jiraIntegration); // Consider adding an authorizer for production

    // Create ticket resource and methods for CRUD operations
    const ticketsResource = this.api.root.addResource('tickets');
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

    // Set up CloudFront distribution for the API
    // Certificate for custom domain
    let certificate;
    let domainNames: string[] = [];
    let apiDomain: string | undefined;

    if (props?.domainName && props?.certificateArn && props?.apiDomainPrefix) {
      // Import the certificate from ACM
      certificate = acm.Certificate.fromCertificateArn(
        this,
        'JiraTimesheetApiCertificate',
        props.certificateArn
      );

      // Set the API domain with prefix (e.g., api.example.com)
      apiDomain = `${props.apiDomainPrefix}.${props.domainName}`;
      domainNames = [apiDomain];
    }

    // Create CloudFront distribution for API
    this.distribution = new cloudfront.Distribution(
      this,
      'JiraTimesheetApiDistribution',
      {
        defaultBehavior: {
          origin: new origins.RestApiOrigin(this.api),
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED, // API responses should not be cached by default
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        domainNames,
        certificate,
      }
    );

    // Create Route53 alias record for the CloudFront distribution
    if (props?.domainName && props?.hostedZoneId && props?.apiDomainPrefix) {
      const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
        this,
        'JiraTimesheetApiHostedZone',
        {
          hostedZoneId: props.hostedZoneId,
          zoneName: props.domainName,
        }
      );

      // Create A record for the API subdomain
      new route53.ARecord(this, 'JiraTimesheetApiAliasRecord', {
        recordName: props.apiDomainPrefix, // This will create api.yourdomain.com
        target: route53.RecordTarget.fromAlias(
          new targets.CloudFrontTarget(this.distribution)
        ),
        zone: hostedZone,
      });
    }

    new CfnOutput(this, 'ApiGatewayUrlOutput', {
      value: this.api.url,
      description: 'The URL of the API Gateway endpoint',
    });

    new CfnOutput(this, 'ApiCloudFrontUrlOutput', {
      value: this.distribution.distributionDomainName,
      description: 'The CloudFront URL for the API',
    });

    if (apiDomain) {
      new CfnOutput(this, 'ApiCustomDomainUrlOutput', {
        value: `https://${apiDomain}`,
        description: 'The custom domain URL for the API',
      });
    }

    new CfnOutput(this, 'TicketsTableName', {
      value: ticketsTable.tableName,
      description: 'The name of the DynamoDB table for tickets',
    });
  }
}
