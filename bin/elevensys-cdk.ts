#!/usr/bin/env node
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
// import { JiraTimesheetUiStack } from '../lib/stacks/jira-timesheet-ui-stack';
import { BaseApiStack } from '../lib/stacks/base-api-stack';
import { UrlifyStack } from '../lib/stacks/urlify-stack';
import { TimesheetCoreStack } from '../lib/stacks/timesheet-core-stack';
import { OpenAIStack } from '../lib/stacks/openai-stack';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const app = new cdk.App();

// Environment configuration
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT || '',
  region: process.env.CDK_DEFAULT_REGION || '',
};

// Configuration for base API domain (api.elevensys.dev)
const baseDomainName = process.env.BASE_DOMAIN_NAME || '';
const baseHostedZoneId = process.env.BASE_HOSTED_ZONE_ID || '';
const baseCertificateArn = process.env.BASE_CERTIFICATE_ARN || '';

// Configuration for URL shortener redirect domain (urlify.cc)
const redirectDomain = process.env.REDIRECT_DOMAIN_NAME || '';
const urlifyHostedZoneId = process.env.API_HOSTED_ZONE_ID || '';
const urlifyCertificateArn = process.env.URLIFY_CERTIFICATE_ARN || '';

// Deploy the Base API Stack first (shared API Gateway)
const baseApiStack = new BaseApiStack(app, 'BaseApiStack', {
  env,
  domainName: baseDomainName,
  hostedZoneId: baseHostedZoneId,
  certificateArn: baseCertificateArn,
});

// Deploy the OpenAI API stack (adds /openai endpoint)
new OpenAIStack(app, 'OpenAIStack', {
  env,
  api: baseApiStack.api,
  baseApiUrl: baseApiStack.apiUrl,
});

// Deploy the Timesheet Core stack (adds /timesheet endpoint)
new TimesheetCoreStack(app, 'TimesheetCoreStack', {
  env,
  api: baseApiStack.api,
  baseApiUrl: baseApiStack.apiUrl,
});

// Deploy the URL Shortener stack (adds /urlify endpoint + separate redirect domain)
new UrlifyStack(app, 'UrlifyStack', {
  env,
  redirectDomain,
  hostedZoneId: urlifyHostedZoneId,
  certificateArn: urlifyCertificateArn,
  api: baseApiStack.api,
  baseApiUrl: baseApiStack.apiUrl,
});
