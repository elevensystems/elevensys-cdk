#!/usr/bin/env node
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { JiraTimesheetUiStack } from '../lib/stacks/jira-timesheet-ui-stack';
import { UrlifyStack } from '../lib/stacks/urlify-stack';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const app = new cdk.App();

// Environment configuration
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT || '',
  region: process.env.CDK_DEFAULT_REGION || '',
};

const redirectDomain = process.env.REDIRECT_DOMAIN_NAME || '';
const adminDomain = process.env.ADMIN_DOMAIN_NAME || '';
const hostedZoneId = process.env.API_HOSTED_ZONE_ID || '';
const urlifyCertificateArn = process.env.URLIFY_CERTIFICATE_ARN || ''; // Required: ACM certificate ARN

// Validate required environment variables for UrlifyStack
if (!urlifyCertificateArn) {
  console.error('❌ ERROR: URLIFY_CERTIFICATE_ARN is required!');
  console.error(
    'Please create an ACM certificate in us-east-1 and set the ARN in .env file'
  );
  console.error('See URLIFY_SETUP.md for detailed instructions');
  process.exit(1);
}

// Configuration for UI domain
const uiDomainName = process.env.UI_DOMAIN_NAME;
const uiHostedZoneId = process.env.UI_HOSTED_ZONE_ID;
const uiCertificateArn = process.env.UI_CERTIFICATE_ARN;

// Deploy the static UI stack backed by S3 + CloudFront
new JiraTimesheetUiStack(app, 'JiraTimesheetUiStack', {
  env,
  domainName: uiDomainName,
  hostedZoneId: uiHostedZoneId,
  certificateArn: uiCertificateArn,
});

// Deploy the URL Shortener stack
new UrlifyStack(app, 'UrlifyStack', {
  env,
  redirectDomain,
  adminDomain,
  hostedZoneId,
  certificateArn: urlifyCertificateArn,
});
