# Lambda Reference

## NodejsFunction (Recommended)

Always use `NodejsFunction` over `Function` for TypeScript/JavaScript — it handles bundling automatically via esbuild.

```typescript
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';

const fn = new lambdaNodejs.NodejsFunction(this, 'ApiHandler', {
  // Entry file path
  entry: path.join(__dirname, '../../src/handlers/api.ts'),
  handler: 'handler',

  // Runtime — always pin to a specific version
  runtime: lambda.Runtime.NODEJS_20_X,

  // Memory: 128MB default is almost always wrong
  // Use 512MB as minimum; tune up for CPU-intensive, down after profiling
  memorySize: 512,

  // Timeout: 3s default is too low for anything non-trivial
  // Max 29s for API Gateway-backed. Up to 15min for async.
  timeout: cdk.Duration.seconds(30),

  // Bundling config — critical for bundle size and cold starts
  bundling: {
    // Exclude AWS SDK v3 — pre-installed in Node 18+ runtime
    externalModules: ['@aws-sdk/*'],
    minify: true,
    sourceMap: true,
    // Tree-shake unused imports
    metafile: false,
  },

  // Always set log retention — default is infinite (costly)
  logRetention: logs.RetentionDays.ONE_MONTH,

  // X-Ray tracing
  tracing: lambda.Tracing.ACTIVE,

  // Environment variables — no secrets here, use Secrets Manager
  environment: {
    NODE_OPTIONS: '--enable-source-maps',
    LOG_LEVEL: 'INFO',
  },
});
```

---

## Dead Letter Queue (Required for Async Invocations)

```typescript
import * as sqs from 'aws-cdk-lib/aws-sqs';

const dlq = new sqs.Queue(this, 'ProcessorDlq', {
  queueName: 'processor-dlq',
  retentionPeriod: cdk.Duration.days(14),
  encryption: sqs.QueueEncryption.KMS_MANAGED,
});

const fn = new lambdaNodejs.NodejsFunction(this, 'Processor', {
  // ...
  deadLetterQueue: dlq,
  retryAttempts: 2,
});

// Alarm on DLQ depth
new cloudwatch.Alarm(this, 'DlqAlarm', {
  metric: dlq.metricApproximateNumberOfMessagesVisible(),
  threshold: 1,
  evaluationPeriods: 1,
});
```

---

## Lambda Layers

Use layers for shared code or large dependencies (e.g., `sharp`, `puppeteer`):

```typescript
const sharedLayer = new lambda.LayerVersion(this, 'SharedLayer', {
  code: lambda.Code.fromAsset(path.join(__dirname, '../../layers/shared')),
  compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
  description: 'Shared utilities and heavy dependencies',
  removalPolicy: cdk.RemovalPolicy.RETAIN, // Retain to avoid breaking deployed functions
});

const fn = new lambdaNodejs.NodejsFunction(this, 'Handler', {
  // ...
  layers: [sharedLayer],
  bundling: {
    // Exclude the layer's packages from the function bundle
    externalModules: ['@aws-sdk/*', 'sharp'],
  },
});
```

---

## Reserved & Provisioned Concurrency

```typescript
// Reserved concurrency — cap the function's max concurrency
// (also guarantees this function won't be throttled by other functions)
fn.addAlias('live', {
  provisionedConcurrentExecutions: undefined, // No provisioned
});

// Prevent Lambda from scaling beyond N concurrent executions
const cfnFn = fn.node.defaultChild as lambda.CfnFunction;
cfnFn.reservedConcurrentExecutions = 100;

// Provisioned concurrency — eliminates cold starts for latency-sensitive functions
const alias = fn.addAlias('live');
alias.addAutoScaling({
  minCapacity: 2,
  maxCapacity: 10,
}).scaleOnUtilization({ utilizationTarget: 0.8 });
```

---

## Event Sources

### API Gateway

```typescript
import * as apigw from 'aws-cdk-lib/aws-apigateway';

const api = new apigw.RestApi(this, 'Api', {
  restApiName: 'MyApi',
  deployOptions: {
    stageName: props.environment,
    loggingLevel: apigw.MethodLoggingLevel.INFO,
    dataTraceEnabled: false, // Don't log request/response bodies in prod
    tracingEnabled: true,    // X-Ray
    throttlingRateLimit: 1000,
    throttlingBurstLimit: 500,
  },
  defaultCorsPreflightOptions: {
    allowOrigins: apigw.Cors.ALL_ORIGINS,
    allowMethods: apigw.Cors.ALL_METHODS,
  },
});

const items = api.root.addResource('items');
items.addMethod('GET', new apigw.LambdaIntegration(fn));
```

### SQS Trigger

```typescript
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as sqs from 'aws-cdk-lib/aws-sqs';

const queue = new sqs.Queue(this, 'Queue', { /* ... */ });

fn.addEventSource(new lambdaEventSources.SqsEventSource(queue, {
  batchSize: 10,
  maxBatchingWindow: cdk.Duration.seconds(30),
  reportBatchItemFailures: true, // Retry only failed messages
}));
```

### EventBridge

```typescript
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';

const rule = new events.Rule(this, 'ScheduleRule', {
  schedule: events.Schedule.cron({ minute: '0', hour: '2' }), // 2am daily
});
rule.addTarget(new targets.LambdaFunction(fn, {
  retryAttempts: 3,
  deadLetterQueue: dlq,
}));
```

---

## IAM — Use Grant Methods

```typescript
// Good — scoped, uses grant methods
table.grantReadWriteData(fn);
bucket.grantRead(fn);
secret.grantRead(fn);

// Also good — explicit resource-scoped policy
fn.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ['ssm:GetParameter'],
  resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/myapp/*`],
}));

// Bad — wildcard resource
fn.addToRolePolicy(new iam.PolicyStatement({
  actions: ['ssm:GetParameter'],
  resources: ['*'], // Never do this
}));
```

---

## Lambda Powertools (Recommended)

Install: `npm install @aws-lambda-powertools/logger @aws-lambda-powertools/tracer @aws-lambda-powertools/metrics`

```typescript
// In Lambda handler code
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';

const logger = new Logger({ serviceName: 'my-service' });
const tracer = new Tracer({ serviceName: 'my-service' });
const metrics = new Metrics({ namespace: 'MyApp', serviceName: 'my-service' });

export const handler = async (event: any) => {
  logger.info('Processing event', { event });
  metrics.addMetric('ItemsProcessed', MetricUnit.Count, 1);
  // ...
};
```

In CDK, set required environment variables:

```typescript
new lambdaNodejs.NodejsFunction(this, 'Handler', {
  environment: {
    POWERTOOLS_SERVICE_NAME: 'my-service',
    POWERTOOLS_LOG_LEVEL: 'INFO',
    POWERTOOLS_METRICS_NAMESPACE: 'MyApp',
  },
});
```
