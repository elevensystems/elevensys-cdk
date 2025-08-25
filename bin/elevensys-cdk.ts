#!/usr/bin/env node
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { JiraTimesheetCaptureStack } from '../lib/stacks/jira-timesheet-capture-stack';
import { JiraTimesheetUiStack } from '../lib/stacks/jira-timesheet-ui-stack';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const app = new cdk.App();

// Environment configuration
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT || '',
  region: process.env.CDK_DEFAULT_REGION || '',
};

// Configuration for API domain
const apiDomainName = process.env.API_DOMAIN_NAME;
const apiHostedZoneId = process.env.API_HOSTED_ZONE_ID;
const apiCertificateArn = process.env.API_CERTIFICATE_ARN;
const apiDomainPrefix = process.env.API_DOMAIN_PREFIX || 'api';

// Configuration for UI domain
const uiDomainName = process.env.UI_DOMAIN_NAME;
const uiHostedZoneId = process.env.UI_HOSTED_ZONE_ID;
const uiCertificateArn = process.env.UI_CERTIFICATE_ARN;

// Deploy the backend API stack with CloudFront and custom domain
new JiraTimesheetCaptureStack(app, 'JiraTimesheetCaptureStack', {
  env,
  domainName: apiDomainName,
  apiDomainPrefix,
  hostedZoneId: apiHostedZoneId,
  certificateArn: apiCertificateArn,
});

// Deploy the static UI stack backed by S3 + CloudFront
new JiraTimesheetUiStack(app, 'JiraTimesheetUiStack', {
  env,
  domainName: uiDomainName,
  hostedZoneId: uiHostedZoneId,
  certificateArn: uiCertificateArn,
});
