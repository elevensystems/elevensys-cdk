import { Duration, Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';

/**
 * BaseApiStack - Shared API Gateway for all services
 *
 * This stack creates a centralized API Gateway with custom domain (api.elevensys.dev)
 * that serves as the base for all microservices.
 *
 * Architecture:
 * - API Gateway REST API with custom domain
 * - Route53 A Record (DNS configuration)
 * - ACM Certificate (SSL/TLS)
 *
 * Child stacks add their resources:
 * - /openai - OpenAI chat completions
 * - /urlify - URL shortener admin API
 * - /timesheet - Timesheet processing
 *
 * Prerequisites:
 * - ACM Certificate in the same region as the stack
 * - Route53 Hosted Zone
 */
export interface BaseApiStackProps extends StackProps {
  /**
   * Custom domain name for the API (e.g., 'api.elevensys.dev')
   */
  domainName: string;

  /**
   * Route53 Hosted Zone ID
   */
  hostedZoneId: string;

  /**
   * ARN of ACM certificate (must be in the same region as the stack)
   */
  certificateArn: string;
}

export class BaseApiStack extends Stack {
  public readonly api: apigateway.RestApi;
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: BaseApiStackProps) {
    super(scope, id, props);

    const certificate = acm.Certificate.fromCertificateArn(
      this,
      'BaseApiCertificate',
      props.certificateArn
    );

    this.api = new apigateway.RestApi(this, 'BaseApi', {
      restApiName: 'ElevenSys Base API',
      description: 'Centralized API Gateway for all ElevenSys services',
      domainName: {
        domainName: props.domainName,
        certificate: certificate,
        endpointType: apigateway.EndpointType.REGIONAL,
        securityPolicy: apigateway.SecurityPolicy.TLS_1_2,
      },
      deployOptions: {
        stageName: 'prod',
        metricsEnabled: false,
        dataTraceEnabled: false,
        loggingLevel: apigateway.MethodLoggingLevel.OFF,
        tracingEnabled: true,
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
      cloudWatchRole: true,
    });

    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
      this,
      'BaseApiHostedZone',
      {
        hostedZoneId: props.hostedZoneId,
        zoneName: props.domainName.split('.').slice(-2).join('.'),
      }
    );

    new route53.ARecord(this, 'BaseApiAliasRecord', {
      recordName: props.domainName,
      target: route53.RecordTarget.fromAlias(new targets.ApiGateway(this.api)),
      zone: hostedZone,
    });

    this.apiUrl = `https://${props.domainName}`;

    new CfnOutput(this, 'BaseApiUrlOutput', {
      value: this.apiUrl,
      description: 'Base API URL',
      exportName: 'BaseApiUrl',
    });

    new CfnOutput(this, 'BaseApiIdOutput', {
      value: this.api.restApiId,
      description: 'Base API Gateway ID',
      exportName: 'BaseApiId',
    });
  }
}
