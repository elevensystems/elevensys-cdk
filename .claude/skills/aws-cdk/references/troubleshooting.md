# Troubleshooting Reference

## Common CDK Errors

### Circular Dependency

**Error:** `Circular dependency between stacks: StackA -> StackB -> StackA`

**Cause:** Stack A consumes a resource from Stack B, AND Stack B consumes a resource from Stack A.

**Fix:** Extract the shared resource into a third stack:

```typescript
// Before: circular
// NetworkStack uses ApiStack.url → ApiStack uses NetworkStack.vpc

// After: extract shared resource
const sharedStack = new SharedStack(app, 'Shared', { env });
const networkStack = new NetworkStack(app, 'Network', { vpc: sharedStack.vpc });
const apiStack = new ApiStack(app, 'Api', { vpc: sharedStack.vpc });
```

---

### Cannot Read Properties of Undefined (Token/Lazy Resolution)

**Error:** `TypeError: Cannot read properties of undefined` or `Cannot use a Token as a stack name`

**Cause:** Trying to use a CloudFormation Token value (like an ARN or ID) as a concrete value at synth time.

**Fix:** Don't use `.value`, `.ref`, or resource IDs in conditions/names at synth time:

```typescript
// Wrong — Token not resolved at synth time
if (bucket.bucketArn === 'arn:aws:s3:::my-bucket') { ... }

// Right — use environment-specific config passed as props
if (props.environment === 'prod') { ... }

// Wrong — can't use token as a stack name
new MyStack(app, bucket.bucketName, { ... });

// Right — use a known string
new MyStack(app, `MyStack-${props.environment}`, { ... });
```

---

### Resource Replacement on Deploy (Construct ID Changed)

**Problem:** CDK wants to destroy and recreate a stateful resource (DynamoDB table, S3 bucket).

**Cause:** The construct ID changed, which changes the logical CloudFormation resource ID.

**Fix — Option A:** Use `overrideLogicalId` to pin the CloudFormation logical ID:

```typescript
const table = new dynamodb.Table(this, 'NewTableId', { ... });
const cfnTable = table.node.defaultChild as dynamodb.CfnTable;
cfnTable.overrideLogicalId('OldTableId');  // Keep the original logical ID
```

**Fix — Option B:** Import the existing resource instead of creating it:

```typescript
const existingTable = dynamodb.Table.fromTableArn(this, 'ExistingTable',
  'arn:aws:dynamodb:us-east-1:123456789012:table/my-table'
);
```

---

### Bootstrap Version Mismatch

**Error:** `This CDK deployment requires bootstrap stack version X, found Y`

**Fix:**

```bash
# Re-bootstrap the target account/region
cdk bootstrap aws://ACCOUNT_ID/REGION --upgrade
```

---

### Asset Upload Failures

**Error:** `Error: Could not assume role arn:aws:iam::xxx:role/cdk-hnb659fds-file-publishing-role`

**Cause:** The CDK pipeline/deployment role doesn't have trust on the bootstrap roles.

**Fix:**

```bash
cdk bootstrap \
  --trust DEPLOYER_ACCOUNT_ID \
  aws://TARGET_ACCOUNT_ID/REGION
```

---

### Stack is in ROLLBACK_COMPLETE State

**Problem:** CloudFormation stack is stuck in `ROLLBACK_COMPLETE`.

**Fix:** You must delete the stack before redeploying:

```bash
aws cloudformation delete-stack --stack-name MyStack
# Wait for deletion
cdk deploy MyStack
```

---

### VPC Lookup Failure in Synth

**Error:** `Vpc.fromLookup` returns a dummy VPC, or `VPC not found`

**Cause:** `vpc.fromLookup` requires AWS credentials at synth time. In CI without credentials, this fails.

**Fix — Option A:** Commit the context cache:

```bash
cdk synth  # Run locally with credentials to populate cdk.context.json
git add cdk.context.json
git commit -m "chore: update cdk context"
```

**Fix — Option B:** Pass the VPC by construct reference instead of lookup:

```typescript
// Avoid fromLookup — pass VPC via props across stacks in the same app
```

---

### Lambda Timeout During Deploy (Custom Resources)

**Error:** Custom resource Lambda times out during `cdk deploy`

**Fix:** Increase the timeout on the custom resource provider:

```typescript
const provider = new cr.Provider(this, 'Provider', {
  onEventHandler: fn,
  totalTimeout: cdk.Duration.minutes(30),
  queryInterval: cdk.Duration.seconds(10),
});
```

---

## Useful Debug Commands

```bash
# Verbose synth output
cdk synth --verbose 2>&1 | head -100

# Show all CloudFormation resources in a stack
cdk synth MyStack | grep "Type: AWS"

# Check what will change before deploying
cdk diff MyStack

# Deploy with detailed progress
cdk deploy MyStack --progress events

# Rollback a failed deployment
aws cloudformation rollback-stack --stack-name MyStack

# Get CloudFormation events for a stack
aws cloudformation describe-stack-events \
  --stack-name MyStack \
  --query 'StackEvents[?ResourceStatus==`CREATE_FAILED` || ResourceStatus==`UPDATE_FAILED`].[LogicalResourceId,ResourceStatusReason]' \
  --output table

# List all stacks and their statuses
aws cloudformation list-stacks \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE ROLLBACK_COMPLETE \
  --query 'StackSummaries[*].[StackName,StackStatus]' \
  --output table

# Force a re-deploy (even if no changes detected)
cdk deploy MyStack --force

# Check current bootstrap version
aws ssm get-parameter \
  --name /cdk-bootstrap/hnb659fds/version \
  --query Parameter.Value \
  --output text
```

---

## cdk.context.json Management

The `cdk.context.json` file caches lookup results (VPC IDs, AMI IDs, etc.):

```bash
# Clear all cached context (will re-lookup on next synth)
cdk context --clear

# Clear a specific key
cdk context --reset "availability-zones:account=123456789012:region=us-east-1"

# List all cached context
cdk context
```

**Always commit `cdk.context.json`** to source control. It ensures reproducible deployments across machines and CI.

---

## Performance: Slow cdk synth

```bash
# Profile what's slow
time cdk synth

# Common causes:
# 1. Too many fromLookup calls → commit cdk.context.json
# 2. NodejsFunction bundling runs on every synth → use bundling.forceDockerBundling: false
# 3. Large number of stacks → only synth the stacks you need: cdk synth MyStack

# Skip bundling for faster local iteration (don't use in CI)
CDK_DOCKER=false cdk synth
```
