# CDK Pipelines & CI/CD Reference

## CDK Pipelines (Self-Mutating Pipeline)

CDK Pipelines is the recommended way to deploy CDK apps. It self-updates when you push changes to the pipeline stack itself.

### Pipeline Stack

```typescript
// lib/stacks/pipeline-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as pipelines from 'aws-cdk-lib/pipelines';
import * as codeconnections from 'aws-cdk-lib/aws-codeconnections';
import { Construct } from 'constructs';

export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    const pipeline = new pipelines.CodePipeline(this, 'Pipeline', {
      pipelineName: 'MyAppPipeline',
      selfMutation: true,   // Pipeline updates itself when you push

      synth: new pipelines.ShellStep('Synth', {
        // GitHub connection (set up via console first)
        input: pipelines.CodePipelineSource.connection('my-org/my-repo', 'main', {
          connectionArn: 'arn:aws:codeconnections:us-east-1:123456789012:connection/xxx',
        }),
        commands: [
          'npm ci',
          'npm run build',
          'npx cdk synth',
        ],
      }),

      // Enable Docker for asset bundling
      dockerEnabledForSynth: true,

      // Publish assets in parallel
      publishAssetsInParallel: true,

      codeBuildDefaults: {
        buildEnvironment: {
          buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
          computeType: codebuild.ComputeType.MEDIUM,
        },
        // Cache node_modules
        cache: codebuild.Cache.bucket(cacheBucket),
      },
    });

    // Add deployment stages
    pipeline.addStage(new AppStage(this, 'Dev', {
      env: { account: '111111111111', region: 'us-east-1' },
      environment: 'dev',
    }));

    // Staging with manual approval
    const stagingStage = pipeline.addStage(new AppStage(this, 'Staging', {
      env: { account: '222222222222', region: 'us-east-1' },
      environment: 'staging',
    }), {
      pre: [new pipelines.ManualApprovalStep('ApproveStaging')],
    });

    // Prod with approval and integration tests
    pipeline.addStage(new AppStage(this, 'Prod', {
      env: { account: '333333333333', region: 'us-east-1' },
      environment: 'prod',
    }), {
      pre: [new pipelines.ManualApprovalStep('ApproveProd')],
      post: [
        new pipelines.ShellStep('IntegrationTests', {
          envFromCfnOutputs: {
            API_URL: stagingStage.stacks[0].apiUrlOutput,
          },
          commands: ['npm run test:integration'],
        }),
      ],
    });
  }
}
```

### App Stage (Groups Stacks for a Given Environment)

```typescript
// lib/stages/app-stage.ts
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface AppStageProps extends cdk.StageProps {
  environment: 'dev' | 'staging' | 'prod';
}

export class AppStage extends cdk.Stage {
  public readonly apiUrlOutput: cdk.CfnOutput;

  constructor(scope: Construct, id: string, props: AppStageProps) {
    super(scope, id, props);

    const networkStack = new NetworkStack(this, 'Network', { environment: props.environment });
    const dbStack = new DatabaseStack(this, 'Database', {
      environment: props.environment,
      vpc: networkStack.vpc,
    });
    const apiStack = new ApiStack(this, 'Api', {
      environment: props.environment,
      table: dbStack.table,
    });

    this.apiUrlOutput = apiStack.apiUrl;
  }
}
```

---

## GitHub Actions + CDK (Alternative to CDK Pipelines)

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

permissions:
  id-token: write   # Required for OIDC
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci

      - name: Configure AWS credentials (OIDC — no static keys)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/GitHubActionsRole
          aws-region: us-east-1

      - run: npm run build

      - name: CDK Diff (PR) / CDK Deploy (main)
        run: |
          if [ "${{ github.ref }}" == "refs/heads/main" ]; then
            npx cdk deploy --all --require-approval never --ci
          else
            npx cdk diff --all
          fi
```

### GitHub OIDC Role (in CDK)

```typescript
import * as iam from 'aws-cdk-lib/aws-iam';

const githubProvider = new iam.OpenIdConnectProvider(this, 'GithubProvider', {
  url: 'https://token.actions.githubusercontent.com',
  clientIds: ['sts.amazonaws.com'],
});

const deployRole = new iam.Role(this, 'GitHubActionsRole', {
  assumedBy: new iam.WebIdentityPrincipal(githubProvider.openIdConnectProviderArn, {
    StringLike: {
      'token.actions.githubusercontent.com:sub': 'repo:my-org/my-repo:ref:refs/heads/main',
    },
  }),
  description: 'Role for GitHub Actions CDK deployments',
  managedPolicies: [
    iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess'), // Scope down in prod
  ],
});
```

---

## Multi-Account Bootstrap

Before using CDK in a new account/region combination:

```bash
# Bootstrap target account (grant the pipeline account trust)
cdk bootstrap \
  --trust PIPELINE_ACCOUNT_ID \
  --trust-for-lookup PIPELINE_ACCOUNT_ID \
  --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess \
  aws://TARGET_ACCOUNT_ID/us-east-1

# Bootstrap pipeline account
cdk bootstrap aws://PIPELINE_ACCOUNT_ID/us-east-1
```

---

## Useful Pipeline Steps

```typescript
// Run unit tests before synth
new pipelines.ShellStep('UnitTests', {
  commands: ['npm ci', 'npm test'],
});

// cdk-nag security check
new pipelines.ShellStep('SecurityCheck', {
  commands: ['npm ci', 'npx cdk synth 2>&1 | grep -i "error\\|warning\\|nag" || true'],
});

// Slack notification
new pipelines.ShellStep('SlackNotify', {
  envFromCfnOutputs: { API_URL: apiUrlOutput },
  commands: [
    `curl -X POST -H 'Content-type: application/json' \
     --data '{"text":"Deployed to prod: $API_URL"}' \
     $SLACK_WEBHOOK_URL`,
  ],
  env: { SLACK_WEBHOOK_URL: 'https://hooks.slack.com/...' }, // Use Secrets Manager in practice
});
```
