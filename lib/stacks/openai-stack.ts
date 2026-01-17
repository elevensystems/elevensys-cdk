import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Architecture, Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import path from 'path';

/**
 * OpenAIStack - OpenAI Chat Completions API
 *
 * This stack adds /openai endpoint to the base API Gateway.
 * Endpoint: https://api.elevensys.dev/openai
 *
 * Architecture:
 * - Lambda Function (handles OpenAI API calls)
 * - SSM Parameter (stores OpenAI API key securely)
 * - API Gateway resource /openai (attached to base API)
 *
 * Features:
 * - Configurable model (defaults to gpt-5-nano)
 * - Secure API key management via SSM Parameter Store
 * - CloudWatch logging for monitoring
 *
 * Prerequisites:
 * - OpenAI API key stored in SSM Parameter Store at /openai/api-key
 * - BaseApiStack must be deployed first
 *
 * Usage:
 * POST https://api.elevensys.dev/openai
 * {
 *   "messages": [
 *     { "role": "user", "content": "Hello!" }
 *   ],
 *   "model": "gpt-5-nano",  // Optional, defaults to "gpt-5-nano"
 *   "temperature": 0.7,     // Optional
 *   "max_completion_tokens": 1000      // Optional
 * }
 */
export interface OpenAIStackProps extends StackProps {
  /**
   * SSM Parameter name for OpenAI API key
   * @default '/openai/api-key'
   */
  apiKeyParameterName?: string;

  /**
   * Base API Gateway from BaseApiStack
   */
  api: apigateway.RestApi;

  /**
   * Base API URL (e.g., 'https://api.elevensys.dev')
   */
  baseApiUrl: string;
}

export class OpenAIStack extends Stack {
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: OpenAIStackProps) {
    super(scope, id, props);

    const apiKeyParameterName = props.apiKeyParameterName || '/openai/api-key';

    const openaiApiKey = ssm.StringParameter.fromStringParameterName(
      this,
      'OpenAIApiKey',
      apiKeyParameterName
    );

    const logGroup = new logs.LogGroup(this, 'OpenAILambdaLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
    });

    const openaiLambda = new lambda.NodejsFunction(this, 'OpenAILambda', {
      entry: path.join(
        __dirname,
        '../../resources/lambda/openai-lambda/index.ts'
      ),
      runtime: Runtime.NODEJS_LATEST,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(30),
      memorySize: 256,
      tracing: Tracing.DISABLED,
      logGroup: logGroup,
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        OPENAI_API_KEY: openaiApiKey.stringValue,
      },
    });

    openaiApiKey.grantRead(openaiLambda);

    const openaiResource = props.api.root.addResource('openai');

    openaiResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(openaiLambda, {
        proxy: true,
      })
    );

    this.apiUrl = `${props.baseApiUrl}/openai`;

    new ssm.StringParameter(this, 'OpenAIApiUrlParameter', {
      parameterName: '/openai/api-url',
      stringValue: this.apiUrl,
      description: 'OpenAI API endpoint URL',
    });
  }
}
