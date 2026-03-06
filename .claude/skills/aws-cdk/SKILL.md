---
name: aws-cdk
description: Expert AWS CDK (Cloud Development Kit) skill for TypeScript projects. Use this skill whenever the user is working with AWS CDK — creating stacks, constructs, or the app entrypoint; designing VPCs, Lambda functions, DynamoDB tables, S3 buckets, API Gateway, SQS/SNS, IAM roles, or any other AWS resource in CDK; reviewing or refactoring CDK code for best practices; debugging CDK synth/deploy errors; setting up CDK pipelines; migrating from CloudFormation to CDK; or asking any question about CDK patterns, construct design, or AWS architecture in CDK. Trigger this skill even for partial CDK tasks like "add a Lambda to my stack" or "how do I share a VPC across stacks".
---

# AWS CDK Skill

This skill provides expert guidance for building, reviewing, and deploying AWS infrastructure with the AWS CDK (TypeScript).

## Quick Reference

- **Stack design** → [references/stacks-and-constructs.md](references/stacks-and-constructs.md)
- **Lambda patterns** → [references/lambda.md](references/lambda.md)
- **Networking (VPC)** → [references/networking.md](references/networking.md)
- **Storage (S3, DynamoDB)** → [references/storage.md](references/storage.md)
- **API & messaging** → [references/api-and-messaging.md](references/api-and-messaging.md)
- **IAM & security** → [references/security.md](references/security.md)
- **CI/CD pipelines** → [references/pipelines.md](references/pipelines.md)
- **Troubleshooting** → [references/troubleshooting.md](references/troubleshooting.md)

---

## Core Principles

Always apply these to every CDK task:

1. **Use L2 constructs first.** Prefer `aws_lambda.Function` over `CfnFunction`. Only drop to L1 (`Cfn*`) when the L2 doesn't expose what you need.
2. **Explicit over implicit.** Set `removalPolicy`, `retention`, `encryption`, and `billingMode` explicitly — never rely on defaults for anything that affects data safety or cost.
3. **Least privilege IAM.** Use `grant*` methods (`bucket.grantRead(fn)`) instead of writing raw IAM policies with wildcards.
4. **No magic strings.** Region, account, ARNs, environment names — use `Stack.of(this).region`, props, or `cdk.context`.
5. **Fail fast at synth time.** Validate all props in the construct constructor. Throw meaningful errors before CloudFormation ever runs.
6. **Tag everything.** Apply `Tags.of(this).add(key, value)` at the app or stack level for cost allocation and auditing.

---

## Project Structure

Standard CDK project layout:

```
my-cdk-app/
├── bin/
│   └── app.ts              # App entry point — instantiates stacks
├── lib/
│   ├── stacks/             # One file per stack
│   │   ├── network-stack.ts
│   │   ├── database-stack.ts
│   │   └── api-stack.ts
│   ├── constructs/         # Reusable L3 constructs
│   │   ├── secure-bucket.ts
│   │   └── monitored-function.ts
│   └── config/             # Environment-specific config
│       └── environments.ts
├── test/
│   └── *.test.ts           # CDK assertions tests
├── cdk.json
└── package.json
```

---

## Decision Guide

Read the relevant reference file based on the task:

| Task | Reference File |
|---|---|
| Designing stacks, props, cross-stack refs | `stacks-and-constructs.md` |
| Lambda functions, bundling, layers | `lambda.md` |
| VPC, subnets, security groups, NAT | `networking.md` |
| S3 buckets, DynamoDB tables | `storage.md` |
| API Gateway, AppSync, SQS, SNS, EventBridge | `api-and-messaging.md` |
| IAM roles, policies, secrets, encryption | `security.md` |
| CDK Pipelines, CodePipeline, CI/CD | `pipelines.md` |
| Synth errors, deploy failures, circular deps | `troubleshooting.md` |

---

## Bootstrapping & CLI

```bash
# First-time setup per account/region
cdk bootstrap aws://ACCOUNT_ID/REGION

# Synthesize CloudFormation templates (always do this first)
cdk synth

# Diff against deployed stack
cdk diff

# Deploy a specific stack
cdk deploy MyStack

# Deploy all stacks
cdk deploy --all

# Destroy (use with caution)
cdk destroy MyStack
```

---

## Testing Pattern

Always write construct tests with `aws-cdk-lib/assertions`:

```typescript
import { Template } from 'aws-cdk-lib/assertions';
import * as cdk from 'aws-cdk-lib';
import { DatabaseStack } from '../lib/stacks/database-stack';

test('DynamoDB table has PITR enabled', () => {
  const app = new cdk.App();
  const stack = new DatabaseStack(app, 'TestStack');
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::DynamoDB::Table', {
    PointInTimeRecoverySpecification: {
      PointInTimeRecoveryEnabled: true,
    },
  });
});
```

---

## Checklist Before Every Deploy

- [ ] `cdk synth` passes with no errors or warnings
- [ ] `cdk diff` reviewed and changes understood
- [ ] Removal policies set on stateful resources (DynamoDB, S3, RDS)
- [ ] IAM policies use `grant*` methods or scoped resources — no `*`
- [ ] Log group retention is set (not infinite)
- [ ] Secrets are in Secrets Manager or SSM — not in environment variables
- [ ] Tests pass: `npm test`
- [ ] `cdk-nag` checks pass (if installed)
