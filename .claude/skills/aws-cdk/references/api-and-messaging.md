# API & Messaging Reference

## API Gateway v2 (HTTP API — Recommended for REST)

HTTP APIs are lower cost and lower latency than REST APIs. Use HTTP API unless you need REST API features (request validation, WAF, usage plans).

```typescript
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as apigwv2authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';

const api = new apigwv2.HttpApi(this, 'Api', {
  apiName: `my-api-${props.environment}`,
  corsPreflight: {
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: [apigwv2.CorsHttpMethod.ANY],
    allowOrigins: isProd ? ['https://app.example.com'] : ['*'],
    maxAge: cdk.Duration.hours(1),
  },
  // Throttling
  defaultThrottleSettings: {
    burstLimit: 500,
    rateLimit: 1000,
  },
});

// Lambda integration
const integration = new apigwv2integrations.HttpLambdaIntegration('ApiIntegration', fn);

api.addRoutes({
  path: '/items',
  methods: [apigwv2.HttpMethod.GET],
  integration,
});

api.addRoutes({
  path: '/items/{id}',
  methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.PUT, apigwv2.HttpMethod.DELETE],
  integration,
});
```

### JWT Authorizer

```typescript
const authorizer = new apigwv2authorizers.HttpJwtAuthorizer('JwtAuthorizer', jwtIssuerUrl, {
  jwtAudience: ['my-audience'],
});

api.addRoutes({
  path: '/protected',
  methods: [apigwv2.HttpMethod.GET],
  integration,
  authorizer,
});
```

---

## AppSync (GraphQL)

```typescript
import * as appsync from 'aws-cdk-lib/aws-appsync';

const api = new appsync.GraphqlApi(this, 'Api', {
  name: `my-graphql-api-${props.environment}`,
  schema: appsync.SchemaFile.fromAsset('schema.graphql'),
  authorizationConfig: {
    defaultAuthorization: {
      authorizationType: appsync.AuthorizationType.USER_POOL,
      userPoolConfig: { userPool },
    },
    additionalAuthorizationModes: [
      { authorizationType: appsync.AuthorizationType.IAM },
    ],
  },
  xrayEnabled: true,
  logConfig: {
    fieldLogLevel: appsync.FieldLogLevel.ERROR,
    excludeVerboseContent: true,
  },
});

// Lambda data source
const fnDataSource = api.addLambdaDataSource('FnDataSource', fn);

fnDataSource.createResolver('QueryGetItemResolver', {
  typeName: 'Query',
  fieldName: 'getItem',
});
```

---

## SQS

```typescript
import * as sqs from 'aws-cdk-lib/aws-sqs';

// Always create DLQ alongside main queue
const dlq = new sqs.Queue(this, 'ProcessorDlq', {
  queueName: `processor-dlq-${props.environment}`,
  retentionPeriod: cdk.Duration.days(14),
  encryption: sqs.QueueEncryption.KMS_MANAGED,
});

const queue = new sqs.Queue(this, 'ProcessorQueue', {
  queueName: `processor-${props.environment}`,
  visibilityTimeout: cdk.Duration.seconds(300), // 6x your Lambda timeout
  retentionPeriod: cdk.Duration.days(4),
  encryption: sqs.QueueEncryption.KMS_MANAGED,
  deadLetterQueue: {
    queue: dlq,
    maxReceiveCount: 3,  // Move to DLQ after 3 failures
  },
});

// FIFO queue (order guaranteed, exactly-once)
const fifoQueue = new sqs.Queue(this, 'OrderQueue', {
  queueName: `orders-${props.environment}.fifo`,  // .fifo suffix required
  fifo: true,
  contentBasedDeduplication: true,
  encryption: sqs.QueueEncryption.KMS_MANAGED,
  deadLetterQueue: { queue: fifoDlq, maxReceiveCount: 3 },
});
```

---

## SNS

```typescript
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';

const topic = new sns.Topic(this, 'NotificationTopic', {
  topicName: `notifications-${props.environment}`,
  displayName: 'Application Notifications',
  masterKey: encryptionKey,
});

// Fan-out: one SNS topic → multiple SQS queues
topic.addSubscription(new snsSubscriptions.SqsSubscription(processingQueue, {
  filterPolicy: {
    eventType: sns.SubscriptionFilter.stringFilter({ allowlist: ['ORDER_CREATED'] }),
  },
  rawMessageDelivery: true,  // Skip SNS envelope wrapper
}));

topic.addSubscription(new snsSubscriptions.SqsSubscription(analyticsQueue));
topic.addSubscription(new snsSubscriptions.LambdaSubscription(alertFn));
topic.addSubscription(new snsSubscriptions.EmailSubscription('ops@example.com'));
```

---

## EventBridge

```typescript
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';

// Custom event bus
const bus = new events.EventBus(this, 'AppEventBus', {
  eventBusName: `myapp-${props.environment}`,
});

// Rule — pattern matching
const orderCreatedRule = new events.Rule(this, 'OrderCreatedRule', {
  eventBus: bus,
  eventPattern: {
    source: ['myapp.orders'],
    detailType: ['OrderCreated'],
  },
  description: 'Trigger processing when an order is created',
});

orderCreatedRule.addTarget(new targets.LambdaFunction(processFn, {
  retryAttempts: 3,
  deadLetterQueue: dlq,
}));
orderCreatedRule.addTarget(new targets.SqsQueue(analyticsQueue));

// Scheduled rule
const dailyReportRule = new events.Rule(this, 'DailyReport', {
  schedule: events.Schedule.cron({ minute: '0', hour: '8', weekDay: 'MON-FRI' }),
});
dailyReportRule.addTarget(new targets.LambdaFunction(reportFn));
```

---

## CloudFront

```typescript
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudfrontOrigins from 'aws-cdk-lib/aws-cloudfront-origins';

const distribution = new cloudfront.Distribution(this, 'Distribution', {
  defaultBehavior: {
    origin: new cloudfrontOrigins.S3Origin(websiteBucket),
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
    compress: true,
  },
  additionalBehaviors: {
    '/api/*': {
      origin: new cloudfrontOrigins.HttpOrigin(api.apiEndpoint.replace('https://', '')),
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
    },
  },
  domainNames: ['app.example.com'],
  certificate: acm.Certificate.fromCertificateArn(this, 'Cert', props.certArn),
  minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
  webAclId: webAcl.attrArn,
  logBucket: logsBucket,
  enableLogging: true,
  priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // US/EU only — cheaper
});
```
