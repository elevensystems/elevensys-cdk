#!/usr/bin/env node
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { BaseApiStack } from '../lib/stacks/base-api-stack';
import { CoreStack } from '../lib/stacks/core-stack';

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

// Email configuration
const fromEmail = process.env.FROM_EMAIL || 'noreply@elevensys.dev';

// Deploy the Base API Stack first (shared API Gateway)
const baseApiStack = new BaseApiStack(app, 'BaseApiStack', {
  env,
  domainName: baseDomainName,
  hostedZoneId: baseHostedZoneId,
  certificateArn: baseCertificateArn,
});

// Deploy the Core stack (elevensys-core as Lambda — handles all API domains)
new CoreStack(app, 'CoreStack', {
  env,
  api: baseApiStack.api,
  baseApiUrl: baseApiStack.apiUrl,
  redirectDomain,
  urlifyHostedZoneId,
  urlifyCertificateArn,
  fromEmail,
});
