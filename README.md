# elevensys-cdk

This is a CDK development project with TypeScript for deploying the Jira Timesheet application.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Custom Domain Setup

To use a custom domain with CloudFront:

1. Create a `.env` file based on `.env.example`
2. Set your `DOMAIN_NAME`, `HOSTED_ZONE_ID`, and `HOSTED_ZONE_NAME` in the `.env` file
3. Provide your existing AWS Certificate Manager certificate ARN in the `CERTIFICATE_ARN` variable
   - Note: The certificate must exist in the us-east-1 region for CloudFront to use it
4. The domain must already exist in Route 53 as a hosted zone
5. Deploy the stack with `npx cdk deploy JiraTimesheetUiStack`

The stack will:

- Configure CloudFront to use your domain with your existing certificate
- Create a Route 53 A record pointing to the CloudFront distribution

## Useful commands

- `npm run build` compile typescript to js
- `npm run watch` watch for changes and compile
- `npm run test` perform the jest unit tests
- `npx cdk deploy` deploy this stack to your default AWS account/region
- `npx cdk diff` compare deployed stack with current state
- `npx cdk synth` emits the synthesized CloudFormation template
