# Urlify Stack - Setup Guide

## Overview

Urlify Stack creates a complete URL shortener system with:

- **Admin API** (`api.urlify.cc`) - Manage shortened URLs
- **Redirect API** (`urlify.cc`) - URL redirection

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        CloudFront                           │
│  ┌──────────────────┐          ┌──────────────────┐         │
│  │ api.urlify.cc    │          │ urlify.cc        │         │
│  │ (Admin API)      │          │ (Redirects)      │         │
│  └────────┬─────────┘          └────────┬─────────┘         │
└───────────┼──────────────────────────────┼──────────────────┘
            │                              │
            ▼                              ▼
    ┌───────────────┐            ┌──────────────────┐
    │ API Gateway   │            │ API Gateway      │
    │ Admin API     │            │ Redirect API     │
    └───────┬───────┘            └────────┬─────────┘
            │                             │
            ▼                             ▼
    ┌───────────────┐            ┌──────────────────┐
    │ Lambda        │            │ Lambda           │
    │ urlifyAdmin   │            │ urlifyRedirect   │
    └───────┬───────┘            └────────┬─────────┘
            │                             │
            └──────────┬──────────────────┘
                       ▼
                ┌──────────────┐
                │  DynamoDB    │
                │ UrlifyTable  │
                └──────────────┘
```

## Configuration Environment Variables

Add the following variables to your `.env` file:

```bash
# Urlify Domains
REDIRECT_DOMAIN_NAME=urlify.cc
ADMIN_DOMAIN_NAME=api.urlify.cc

# Route53 Hosted Zone ID (for urlify.cc)
# Find in AWS Console > Route53 > Hosted Zones
API_HOSTED_ZONE_ID=Z1234567890ABC

# SSL Certificate ARN (REQUIRED - must be in us-east-1)
# Certificate must cover both urlify.cc and *.urlify.cc
URLIFY_CERTIFICATE_ARN=arn:aws:acm:us-east-1:123456789012:certificate/xxx-xxx-xxx
```

## Step 1: Create SSL Certificate in ACM

**IMPORTANT NOTE**:

- Certificate MUST be in `us-east-1` region (CloudFront requirement)
- Certificate MUST cover both domains: `urlify.cc` and `*.urlify.cc` (wildcard)

### How to Create Certificate:

1. **Go to AWS Console > Certificate Manager** (select region **us-east-1**)

2. **Request Certificate**:
   - Select "Request a public certificate"
   - Click "Next"

3. **Domain names**:
   - Fully qualified domain name: `urlify.cc`
   - Click "Add another name to this certificate"
   - Add: `*.urlify.cc`

4. **Validation method**:
   - Select "DNS validation" (recommended)
   - Click "Request"

5. **DNS Validation**:
   - AWS will provide CNAME records
   - Add these CNAME records to Route53
   - Wait for certificate to be validated (5-30 minutes)

6. **Copy ARN**:
   - After certificate status = "Issued"
   - Copy ARN (format: `arn:aws:acm:us-east-1:xxx:certificate/xxx`)
   - Add to `.env` file

7. **Validate Certificate** (Optional):

   ```bash
   # Use helper script to validate certificate
   ./scripts/validate-certificate.sh arn:aws:acm:us-east-1:xxx:certificate/xxx
   ```

   Script will check:
   - ✅ Certificate is in us-east-1 region
   - ✅ Certificate status = ISSUED
   - ✅ Certificate covers both urlify.cc and \*.urlify.cc

### Example Creating Certificate with AWS CLI:

```bash
# Request certificate
aws acm request-certificate \
  --domain-name urlify.cc \
  --subject-alternative-names "*.urlify.cc" \
  --validation-method DNS \
  --region us-east-1

# Get validation records
aws acm describe-certificate \
  --certificate-arn arn:aws:acm:us-east-1:xxx:certificate/xxx \
  --region us-east-1

# Add CNAME records to Route53 for validation
```

## Step 2: Deploy Stack

## Step 1: Create or Prepare SSL Certificate

### Option 1: Stack Automatically Creates Certificate (Recommended)

If you DO NOT set `URLIFY_CERTIFICATE_ARN`, the stack will automatically:

1. Create ACM Certificate for `urlify.cc` and `*.urlify.cc`
2. Automatically create DNS validation records in Route53
3. Wait for certificate to be validated (takes about 5-30 minutes)

```bash
# No need to set URLIFY_CERTIFICATE_ARN
npm run cdk deploy UrlifyStack
```

### Option 2: Use Existing Certificate

If you already have a certificate:

1. Go to AWS Console > Certificate Manager (us-east-1)
2. Copy the certificate ARN
3. Set environment variable:

```bash
URLIFY_CERTIFICATE_ARN=arn:aws:acm:us-east-1:123456789012:certificate/your-cert-id
```

**IMPORTANT NOTE**:

- Certificate MUST be in `us-east-1` region (CloudFront requirement)
- Certificate MUST cover both domains: `urlify.cc` and `*.urlify.cc`

## Step 2: Deploy Stack

```bash
npm run cdk deploy UrlifyStack
```

The stack will create:

- ✅ DynamoDB table
- ✅ 2 Lambda functions
- ✅ 2 API Gateways
- ✅ 2 CloudFront distributions
- ✅ SSL Certificate (if not already exists)
- ✅ Route53 A records

## Step 3: Check DNS Propagation

After deployment, verify DNS is pointing correctly:

```bash
# Check admin domain
dig api.urlify.cc

# Check redirect domain
dig urlify.cc
```

## Step 4: Test API

### Test Admin API

```bash
# Health check
curl https://api.urlify.cc/api/health

# Create shortened URL
curl -X POST https://api.urlify.cc/api/shorten \
  -H "Content-Type: application/json" \
  -d '{"originalUrl": "https://www.google.com", "createdBy": "test"}'

# Get statistics
curl https://api.urlify.cc/api/stats/abc123

# List URLs
curl https://api.urlify.cc/api/urls

# Delete URL
curl -X DELETE https://api.urlify.cc/api/url/abc123
```

### Test Redirect

```bash
# Test redirect (will redirect to original URL)
curl -L https://urlify.cc/abc123
```

## API Endpoints

### Admin API (`api.urlify.cc`)

| Method | Endpoint                 | Description                     |
| ------ | ------------------------ | ------------------------------- |
| GET    | `/api/health`            | Health check                    |
| POST   | `/api/shorten`           | Create shortened URL            |
| GET    | `/api/stats/{shortCode}` | View URL statistics             |
| GET    | `/api/urls`              | List all URLs (with pagination) |
| DELETE | `/api/url/{shortCode}`   | Delete URL                      |

### Redirect API (`urlify.cc`)

| Method | Endpoint       | Description              |
| ------ | -------------- | ------------------------ |
| GET    | `/{shortCode}` | Redirect to original URL |

## DynamoDB Schema

**Table**: `UrlifyTable`

```
PK (String): URL#{shortCode}
SK (String): METADATA
ShortCode (String): Short code (6 characters)
OriginalUrl (String): Original URL
Clicks (Number): Number of clicks
CreatedAt (Number): Creation timestamp
LastAccessed (Number): Last access timestamp
TTL (Number): Time to live (30 days)
CreatedBy (String): Creator (optional)
EntityType (String): "URL"
```

## Caching Strategy

### Admin API

- **No caching** (TTL = 0) - Always realtime data
- Forward headers: Authorization, Content-Type, Accept

### Redirect API

- **Default TTL**: 5 minutes
- **Max TTL**: 24 hours
- **Min TTL**: 1 second
- Optimized performance for URL redirects

## Troubleshooting

### 403 Error from CloudFront

**Cause**: Certificate not validated or DNS not propagated

**Solution**:

1. Check certificate status in ACM Console
2. Wait for DNS propagation (can take up to 48 hours)
3. Test directly via API Gateway first:
   ```bash
   # Get API Gateway URL from CloudFormation Outputs
   curl https://{api-id}.execute-api.us-east-1.amazonaws.com/prod/api/health
   ```

### Certificate Validation Stuck

**Solution**:

1. Check Route53 has CNAME records for validation
2. If using manual validation, check email
3. Destroy and redeploy stack:
   ```bash
   npm run cdk destroy UrlifyStack
   npm run cdk deploy UrlifyStack
   ```

### DynamoDB Access Denied

**Cause**: Lambda doesn't have permission

**Solution**: Redeploy stack (permissions are auto-granted in stack)

## Monitoring

### CloudWatch Logs

- Admin Lambda: `/aws/lambda/UrlifyStack-UrlifyAdminLambda-xxx`
- Redirect Lambda: `/aws/lambda/UrlifyStack-UrlifyLambda-xxx`

### CloudWatch Metrics

Monitor these metrics:

- Lambda Invocations
- Lambda Errors
- Lambda Duration
- DynamoDB Read/Write Capacity
- CloudFront Cache Hit Rate

## Estimated Cost

With 1 million requests/month:

| Service              | Cost/month |
| -------------------- | ---------- |
| Lambda               | ~$0.20     |
| DynamoDB (On-Demand) | ~$1.25     |
| CloudFront           | ~$0.85     |
| Route53              | $0.50      |
| **Total**            | **~$2.80** |

## Security Best Practices

1. **API Authentication**: Add API Key or Cognito for Admin API
2. **Rate Limiting**: Configure API Gateway throttling
3. **WAF**: Add AWS WAF for CloudFront
4. **Monitoring**: Setup CloudWatch Alarms
5. **Backup**: Enable Point-in-Time Recovery for DynamoDB

## Cleanup

To delete the entire stack:

```bash
npm run cdk destroy UrlifyStack
```

**NOTE**: DynamoDB table will be deleted (RemovalPolicy = DESTROY). Backup first if needed!
