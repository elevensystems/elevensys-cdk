# Stacks & Constructs Reference

## Stack Design

### Stack Props Pattern

Always define a typed props interface:

```typescript
// lib/stacks/database-stack.ts
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface DatabaseStackProps extends cdk.StackProps {
  readonly environment: 'dev' | 'staging' | 'prod';
  readonly removalPolicy?: cdk.RemovalPolicy;
  readonly enablePitr?: boolean;
}

export class DatabaseStack extends cdk.Stack {
  // Expose resources that other stacks need
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    // Validate at construction time — fail at synth, not deploy
    if (props.environment === 'prod' && props.removalPolicy === cdk.RemovalPolicy.DESTROY) {
      throw new Error('Cannot use DESTROY removal policy in production');
    }

    const isProd = props.environment === 'prod';

    this.table = new dynamodb.Table(this, 'Table', {
      removalPolicy: props.removalPolicy ?? (isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY),
      pointInTimeRecovery: props.enablePitr ?? isProd,
      // ...
    });
  }
}
```

### App Entry Point (bin/app.ts)

```typescript
import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../lib/stacks/network-stack';
import { DatabaseStack } from '../lib/stacks/database-stack';
import { ApiStack } from '../lib/stacks/api-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const environment = app.node.tryGetContext('environment') ?? 'dev';

// Tag all resources at the app level
cdk.Tags.of(app).add('Project', 'MyApp');
cdk.Tags.of(app).add('Environment', environment);
cdk.Tags.of(app).add('ManagedBy', 'CDK');

const networkStack = new NetworkStack(app, `MyApp-Network-${environment}`, { env, environment });

const dbStack = new DatabaseStack(app, `MyApp-Database-${environment}`, {
  env,
  environment,
  vpc: networkStack.vpc,       // Direct L2 reference — no export/import needed
});

const apiStack = new ApiStack(app, `MyApp-Api-${environment}`, {
  env,
  environment,
  table: dbStack.table,
  vpc: networkStack.vpc,
});
```

---

## Cross-Stack References

### Method 1: Direct L2 Reference (Preferred)

Pass resources as props between stacks in the same app. CDK handles the export/import automatically:

```typescript
// Stack A exposes the resource
export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  constructor(scope, id, props) {
    super(scope, id, props);
    this.vpc = new ec2.Vpc(this, 'Vpc', { /* ... */ });
  }
}

// Stack B consumes it via props
export interface ApiStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
}
export class ApiStack extends cdk.Stack {
  constructor(scope, id, props: ApiStackProps) {
    super(scope, id, props);
    // Use props.vpc directly
  }
}
```

### Method 2: SSM Parameter Store (Cross-Account/Region)

Use when stacks are in different accounts or regions:

```typescript
// Producer stack
new ssm.StringParameter(this, 'VpcId', {
  parameterName: `/myapp/${environment}/vpc-id`,
  stringValue: this.vpc.vpcId,
});

// Consumer stack
const vpcId = ssm.StringParameter.valueFromLookup(this, `/myapp/${environment}/vpc-id`);
```

---

## L3 Constructs (Patterns)

Create L3 constructs for reusable combinations of resources:

```typescript
// lib/constructs/monitored-function.ts
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface MonitoredFunctionProps {
  readonly entry: string;
  readonly handler?: string;
  readonly memorySize?: number;
  readonly timeout?: cdk.Duration;
  readonly environment?: Record<string, string>;
  readonly errorThreshold?: number;
}

export class MonitoredFunction extends Construct {
  public readonly function: lambdaNodejs.NodejsFunction;
  public readonly errorAlarm: cloudwatch.Alarm;

  constructor(scope: Construct, id: string, props: MonitoredFunctionProps) {
    super(scope, id);

    this.function = new lambdaNodejs.NodejsFunction(this, 'Function', {
      entry: props.entry,
      handler: props.handler ?? 'handler',
      memorySize: props.memorySize ?? 512,
      timeout: props.timeout ?? cdk.Duration.seconds(30),
      environment: props.environment,
      logRetention: logs.RetentionDays.ONE_MONTH,
      tracing: lambda.Tracing.ACTIVE,
      bundling: {
        externalModules: ['@aws-sdk/*'],
        minify: true,
        sourceMap: true,
      },
    });

    this.errorAlarm = new cloudwatch.Alarm(this, 'ErrorAlarm', {
      metric: this.function.metricErrors({ period: cdk.Duration.minutes(5) }),
      threshold: props.errorThreshold ?? 1,
      evaluationPeriods: 1,
      alarmDescription: `${id} error rate exceeded threshold`,
    });
  }
}
```

---

## Aspects

Use Aspects to enforce rules across all resources in a stack or app:

```typescript
import * as cdk from 'aws-cdk-lib';
import { IAspect } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { IConstruct } from 'constructs';

// Enforce SSL on all S3 buckets
class EnforceS3Ssl implements IAspect {
  visit(node: IConstruct): void {
    if (node instanceof s3.Bucket) {
      node.addToResourcePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.DENY,
          principals: [new iam.AnyPrincipal()],
          actions: ['s3:*'],
          resources: [node.bucketArn, `${node.bucketArn}/*`],
          conditions: { Bool: { 'aws:SecureTransport': 'false' } },
        }),
      );
    }
  }
}

// Apply in app.ts or individual stacks
cdk.Aspects.of(app).add(new EnforceS3Ssl());
```

---

## Stack Naming & IDs

- **Stack names** become the CloudFormation stack name: use `MyApp-Api-prod` not `myapp-api-prod`
- **Construct IDs** are PascalCase, stable, and describe the resource: `UserTable`, `AssetsBucket`, `ApiHandler`
- **Changing a construct ID renames the resource** — CloudFormation will destroy and recreate it. Never change IDs on stateful resources.

```typescript
// Good — stable, descriptive
new s3.Bucket(this, 'AssetsBucket', { ... });
new dynamodb.Table(this, 'UserTable', { ... });

// Bad — unstable, vague
new s3.Bucket(this, 'Bucket1', { ... });
new dynamodb.Table(this, 'table', { ... });
```
