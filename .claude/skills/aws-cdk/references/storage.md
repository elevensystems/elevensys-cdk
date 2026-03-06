# Storage Reference

## S3 Buckets

### Production-Ready Bucket

```typescript
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';

const key = new kms.Key(this, 'BucketKey', {
  enableKeyRotation: true,
  description: 'Key for assets bucket',
  removalPolicy: cdk.RemovalPolicy.RETAIN,
});

const bucket = new s3.Bucket(this, 'AssetsBucket', {
  // Encryption
  encryption: s3.BucketEncryption.KMS,
  encryptionKey: key,

  // Public access — always explicit
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,

  // Versioning — for critical data
  versioned: true,

  // Access logging
  serverAccessLogsBucket: logsBucket,
  serverAccessLogsPrefix: 'assets/',

  // Enforce HTTPS
  enforceSSL: true,

  // Lifecycle rules — prevent unbounded storage costs
  lifecycleRules: [
    {
      id: 'TransitionToIA',
      enabled: true,
      transitions: [
        {
          storageClass: s3.StorageClass.INFREQUENT_ACCESS,
          transitionAfter: cdk.Duration.days(30),
        },
        {
          storageClass: s3.StorageClass.GLACIER,
          transitionAfter: cdk.Duration.days(90),
        },
      ],
    },
    {
      id: 'DeleteOldVersions',
      enabled: true,
      noncurrentVersionExpiration: cdk.Duration.days(30),
      noncurrentVersionsToRetain: 3,
    },
  ],

  // Removal policy — RETAIN for prod data, DESTROY for ephemeral
  removalPolicy: cdk.RemovalPolicy.RETAIN,
  autoDeleteObjects: false, // Only true with DESTROY policy
});
```

### Bucket Notifications

```typescript
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';

// Trigger Lambda on object creation
bucket.addEventNotification(
  s3.EventType.OBJECT_CREATED,
  new s3n.LambdaDestination(processorFn),
  { prefix: 'uploads/', suffix: '.csv' },
);

// Publish to SNS
bucket.addEventNotification(
  s3.EventType.OBJECT_REMOVED,
  new s3n.SnsDestination(topic),
);
```

### Deployment (Static Sites)

```typescript
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';

new s3deploy.BucketDeployment(this, 'DeployWebsite', {
  sources: [s3deploy.Source.asset('./dist')],
  destinationBucket: websiteBucket,
  distribution: cloudFrontDistribution,         // Invalidate CloudFront cache
  distributionPaths: ['/*'],
  cacheControl: [
    s3deploy.CacheControl.fromString('max-age=31536000,public,immutable'), // Hashed assets
  ],
});
```

---

## DynamoDB

### Production-Ready Table

```typescript
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

const table = new dynamodb.Table(this, 'UserTable', {
  tableName: `users-${props.environment}`,

  // Key schema
  partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },

  // Billing — PAY_PER_REQUEST for variable/unknown workloads
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,

  // Point-in-time recovery — always on for prod
  pointInTimeRecovery: isProd,

  // Encryption
  encryption: dynamodb.TableEncryption.AWS_MANAGED,

  // Streams — only enable if needed (Lambda triggers, replication)
  stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,

  // Removal policy — CRITICAL: always RETAIN for prod tables
  removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
});
```

### Global Secondary Indexes

```typescript
// Add GSI for alternate access patterns
table.addGlobalSecondaryIndex({
  indexName: 'GSI1',
  partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
  projectionType: dynamodb.ProjectionType.ALL,
  // For PROVISIONED tables: set read/write capacity
});

// Local Secondary Index (must be defined at table creation)
const tableWithLsi = new dynamodb.Table(this, 'TableWithLsi', {
  partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
  // ...
});
tableWithLsi.addLocalSecondaryIndex({
  indexName: 'LSI1',
  sortKey: { name: 'CreatedAt', type: dynamodb.AttributeType.NUMBER },
  projectionType: dynamodb.ProjectionType.KEYS_ONLY,
});
```

### Auto-Scaling (Provisioned Mode)

```typescript
const table = new dynamodb.Table(this, 'Table', {
  billingMode: dynamodb.BillingMode.PROVISIONED,
  readCapacity: 5,
  writeCapacity: 5,
  // ...
});

// Auto-scale read capacity
const readScaling = table.autoScaleReadCapacity({
  minCapacity: 5,
  maxCapacity: 1000,
});
readScaling.scaleOnUtilization({ targetUtilizationPercent: 75 });

// Auto-scale write capacity
const writeScaling = table.autoScaleWriteCapacity({
  minCapacity: 5,
  maxCapacity: 500,
});
writeScaling.scaleOnUtilization({ targetUtilizationPercent: 75 });
```

### DynamoDB Streams → Lambda

```typescript
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';

processorFn.addEventSource(new lambdaEventSources.DynamoEventSource(table, {
  startingPosition: lambda.StartingPosition.TRIM_HORIZON,
  batchSize: 100,
  bisectBatchOnError: true,   // On error, bisect batch to isolate poison pill
  retryAttempts: 3,
  onFailure: new lambdaEventSources.SqsDlq(dlq),
  filters: [
    lambda.FilterCriteria.filter({
      eventName: lambda.FilterRule.isEqual('INSERT'),
    }),
  ],
}));
```

---

## ElastiCache (Redis)

```typescript
import * as elasticache from 'aws-cdk-lib/aws-elasticache';

const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
  description: 'Redis subnet group',
  subnetIds: vpc.isolatedSubnets.map(s => s.subnetId),
});

const redis = new elasticache.CfnReplicationGroup(this, 'Redis', {
  replicationGroupDescription: 'My Redis cluster',
  numCacheClusters: isProd ? 2 : 1,
  cacheNodeType: 'cache.t4g.small',
  engine: 'redis',
  engineVersion: '7.1',
  atRestEncryptionEnabled: true,
  transitEncryptionEnabled: true,
  cacheSubnetGroupName: redisSubnetGroup.ref,
  securityGroupIds: [redisSg.securityGroupId],
  automaticFailoverEnabled: isProd,
  multiAzEnabled: isProd,
});
```

---

## RDS Aurora Serverless v2

```typescript
import * as rds from 'aws-cdk-lib/aws-rds';

const cluster = new rds.DatabaseCluster(this, 'AuroraCluster', {
  engine: rds.DatabaseClusterEngine.auroraPostgres({
    version: rds.AuroraPostgresEngineVersion.VER_15_4,
  }),
  writer: rds.ClusterInstance.serverlessV2('Writer'),
  readers: isProd ? [rds.ClusterInstance.serverlessV2('Reader')] : [],
  serverlessV2MinCapacity: 0.5,
  serverlessV2MaxCapacity: isProd ? 16 : 4,
  vpc,
  vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  securityGroups: [dbSg],
  credentials: rds.Credentials.fromGeneratedSecret('postgres'),
  backup: { retention: isProd ? cdk.Duration.days(30) : cdk.Duration.days(1) },
  storageEncrypted: true,
  removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
});

// Grant Lambda access to the secret
cluster.secret?.grantRead(fn);
```
