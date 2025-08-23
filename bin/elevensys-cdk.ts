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

// Deploy the backend API stack
new JiraTimesheetCaptureStack(app, 'JiraTimesheetCaptureStack', {
  env,
});

// Deploy the static UI stack backed by S3 + CloudFront
new JiraTimesheetUiStack(app, 'JiraTimesheetUiStack', {
  env,
  // Optional: path to a pre-built Next.js static export (e.g., "out").
  // If not provided or missing, the stack will only provision infra.
  siteDir: process.env.NEXT_STATIC_DIR || 'jira-timesheet-site',
});
