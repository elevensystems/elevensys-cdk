# Security & IAM Reference

## IAM Best Practices

### Always Use Grant Methods First

L2 constructs expose `grant*` methods that create scoped policies automatically:

```typescript
// S3
bucket.grantRead(fn);
bucket.grantWrite(fn);
bucket.grantReadWrite(fn);
bucket.grantPut(fn);
bucket.grantDelete(fn);

// DynamoDB
table.grantReadData(fn);
table.grantWriteData(fn);
table.grantReadWriteData(fn);
table.grantStream(fn);

// SQS
queue.grantSendMessages(fn);
queue.grantConsumeMessages(fn);
queue.grantPurge(fn);

// SNS
topic.grantPublish(fn);

// Secrets Manager
secret.grantRead(fn);
secret.grantWrite(fn);

// KMS
key.grantEncryptDecrypt(fn);
```

### Scoped Custom Policies (When Grant Methods Aren't Available)

```typescript
fn.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: [
    'ssm:GetParameter',
    'ssm:GetParameters',
    'ssm:GetParametersByPath',
  ],
  // Always scope to specific resources — never '*'
  resources: [
    `arn:aws:ssm:${this.region}:${this.account}:parameter/myapp/${props.environment}/*`,
  ],
}));
```

### IAM Roles for Services

```typescript
// ECS task role (application permissions)
const taskRole = new iam.Role(this, 'TaskRole', {
  assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
  description: 'Role for ECS application containers',
});
table.grantReadWriteData(taskRole);
bucket.grantRead(taskRole);

// Cross-account role
const crossAccountRole = new iam.Role(this, 'CrossAccountRole', {
  assumedBy: new iam.AccountPrincipal('123456789012'),
  externalIds: ['my-external-id'],  // Extra security for cross-account
});
```

---

## Secrets Manager

### Storing Secrets

```typescript
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

// Auto-generated secret (for RDS passwords, API keys, etc.)
const dbPassword = new secretsmanager.Secret(this, 'DbPassword', {
  secretName: `/myapp/${props.environment}/db-password`,
  generateSecretString: {
    secretStringTemplate: JSON.stringify({ username: 'admin' }),
    generateStringKey: 'password',
    excludeCharacters: '"@/\\\'',
    passwordLength: 32,
  },
  removalPolicy: cdk.RemovalPolicy.RETAIN,
});

// Manual secret (value set separately via CLI or console)
const apiKey = new secretsmanager.Secret(this, 'ApiKey', {
  secretName: `/myapp/${props.environment}/third-party-api-key`,
  description: 'Third-party service API key — update manually',
  removalPolicy: cdk.RemovalPolicy.RETAIN,
});
```

### Consuming Secrets in Lambda

```typescript
// Reference the secret ARN via environment variable (NOT the value)
new lambdaNodejs.NodejsFunction(this, 'Handler', {
  environment: {
    // Pass the ARN, not the value — retrieve at runtime
    DB_SECRET_ARN: dbPassword.secretArn,
  },
});
dbPassword.grantRead(fn);

// In Lambda handler:
// const client = new SecretsManagerClient({});
// const { SecretString } = await client.send(new GetSecretValueCommand({ SecretId: process.env.DB_SECRET_ARN }));
// const { username, password } = JSON.parse(SecretString);
```

---

## SSM Parameter Store

Use for non-sensitive config values:

```typescript
import * as ssm from 'aws-cdk-lib/aws-ssm';

// Store config
new ssm.StringParameter(this, 'ApiUrl', {
  parameterName: `/myapp/${props.environment}/api-url`,
  stringValue: api.url,
  tier: ssm.ParameterTier.STANDARD,
});

// Secure string for sensitive but non-rotated values
new ssm.StringParameter(this, 'DbConnectionString', {
  parameterName: `/myapp/${props.environment}/db-connection`,
  stringValue: 'placeholder',  // Update manually
  // Note: SecureString requires CfnParameter (L1) for CDK
});

// Read at synth time (for stack config, not Lambda runtime)
const apiUrl = ssm.StringParameter.valueFromLookup(this, `/myapp/${props.environment}/api-url`);

// Read at deploy time (preferred — avoids synth-time lookups)
const apiUrl = ssm.StringParameter.valueForStringParameter(this, `/myapp/${props.environment}/api-url`);
```

---

## KMS Encryption

```typescript
import * as kms from 'aws-cdk-lib/aws-kms';

// Customer-managed key
const key = new kms.Key(this, 'AppKey', {
  alias: `myapp-${props.environment}`,
  description: 'Application data encryption key',
  enableKeyRotation: true,        // Auto-rotate annually
  removalPolicy: cdk.RemovalPolicy.RETAIN,
  pendingWindow: cdk.Duration.days(30),  // 30-day deletion grace period

  // Key policy — who can administer and use the key
  admins: [new iam.AccountRootPrincipal()],
});

// Use in resources
const table = new dynamodb.Table(this, 'Table', {
  encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
  encryptionKey: key,
  // ...
});

const bucket = new s3.Bucket(this, 'Bucket', {
  encryption: s3.BucketEncryption.KMS,
  encryptionKey: key,
  // ...
});
```

---

## cdk-nag (Automated Security Checks)

Install: `npm install cdk-nag`

```typescript
// bin/app.ts
import { AwsSolutionsChecks } from 'cdk-nag';
import * as cdk from 'aws-cdk-lib';

const app = new cdk.App();

// Apply checks to all stacks
cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

// Suppress known false positives
import { NagSuppressions } from 'cdk-nag';
NagSuppressions.addStackSuppressions(myStack, [
  {
    id: 'AwsSolutions-IAM4',
    reason: 'AWSLambdaBasicExecutionRole is acceptable for this function',
  },
]);
```

Run `cdk synth` to see all nag violations. Fix Critical and High findings before deploying to production.

---

## WAF (Web Application Firewall)

```typescript
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';

const webAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
  scope: 'CLOUDFRONT',  // or 'REGIONAL' for ALB/API Gateway
  defaultAction: { allow: {} },
  rules: [
    {
      name: 'AWSManagedRulesCommonRuleSet',
      priority: 1,
      statement: {
        managedRuleGroupStatement: {
          vendorName: 'AWS',
          name: 'AWSManagedRulesCommonRuleSet',
        },
      },
      overrideAction: { none: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'CommonRuleSet',
        sampledRequestsEnabled: true,
      },
    },
  ],
  visibilityConfig: {
    cloudWatchMetricsEnabled: true,
    metricName: 'WebAcl',
    sampledRequestsEnabled: true,
  },
});
```
