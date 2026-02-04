# CLAUDE.md - AI Assistant Guide for elevensys-cdk

## Project Overview

**elevensys-cdk** is an AWS CDK infrastructure-as-code project written in TypeScript. It deploys a microservices platform with multiple integrated services:

- **Jira Timesheet Integration** - Async job processing for bulk timesheet logging
- **URL Shortener (Urlify)** - URL shortening with click tracking and custom domain
- **OpenAI API Wrapper** - Proxied access to OpenAI's API

All services share a common API Gateway at `api.elevensys.dev`.

## Tech Stack

- **AWS CDK 2.219.0** - Infrastructure as Code
- **TypeScript 5.6.3** - Primary language
- **Node.js 20.x** - Runtime (Lambda functions)
- **AWS SDK v3** - DynamoDB, SQS, SSM clients
- **Jest 29.7.0** - Testing framework

## Directory Structure

```
elevensys-cdk/
├── bin/                          # CDK app entry point
│   └── elevensys-cdk.ts         # Main application - stack orchestration
├── lib/
│   └── stacks/                  # CDK stack definitions
│       ├── base-api-stack.ts    # Shared API Gateway (api.elevensys.dev)
│       ├── openai-stack.ts      # OpenAI API integration
│       ├── timesheet-core-stack.ts # Jira timesheet processing
│       ├── urlify-stack.ts      # URL shortener service
│       └── jira-timesheet-ui-stack.ts # UI static hosting (commented out)
├── resources/
│   ├── lambda/                  # Lambda function implementations
│   │   ├── job-creator-lambda/    # Creates timesheet jobs
│   │   ├── ticket-worker-lambda/  # Processes individual tickets
│   │   ├── job-status-lambda/     # Returns job progress
│   │   ├── openai-lambda/         # OpenAI API proxy
│   │   ├── urlify-lambda/         # URL redirect handler
│   │   └── urlify-admin-lambda/   # URL management API
│   └── shared/                  # Shared code across lambdas
│       ├── constants/
│       ├── models/              # TypeScript interfaces
│       ├── services/            # AWS service wrappers
│       └── utils/               # Helper functions
├── test/                        # Jest unit tests
└── .github/workflows/           # CI/CD (deploy.yml)
```

## Common Commands

```bash
# Development
npm run build              # Compile TypeScript
npm run watch              # Watch mode compilation
npm run test               # Run Jest tests
npm run format             # Format with Prettier

# CDK Operations
npx cdk deploy             # Deploy all stacks
npx cdk deploy <StackName> # Deploy specific stack
npx cdk diff               # Preview changes
npx cdk synth              # Generate CloudFormation
npx cdk destroy            # Destroy stacks
```

## Code Style & Conventions

### Prettier Configuration
- **Print width:** 80 characters
- **Indentation:** 2 spaces (no tabs)
- **Semicolons:** Required
- **Quotes:** Single quotes
- **Trailing commas:** ES5 compatible

### TypeScript
- Strict mode enabled
- Target: ES2022
- Module: NodeNext
- Always use explicit types for function parameters and return values

### Naming Conventions
- **Files:** kebab-case (e.g., `base-api-stack.ts`, `job-creator-lambda`)
- **Classes:** PascalCase (e.g., `BaseApiStack`, `DynamoDbService`)
- **Functions/Variables:** camelCase
- **Constants:** UPPER_SNAKE_CASE for true constants
- **DynamoDB Keys:** PascalCase (e.g., `PK`, `SK`, `ShortCode`)

## CDK Stacks

### BaseApiStack (Foundation)
- Centralized REST API Gateway at `api.elevensys.dev`
- All other stacks attach their resources to this API
- Handles SSL certificate and Route53 DNS

### TimesheetCoreStack
- **Endpoints:** `POST /timesheet/jobs`, `GET /timesheet/jobs/status`
- **Architecture:** Job Creator → SQS Queue → Ticket Workers
- **Storage:** DynamoDB with TTL
- Uses UUIDv7 for job IDs

### UrlifyStack
- **Admin API:** `api.elevensys.dev/urlify/*`
- **Redirect Domain:** `urlify.cc/{shortCode}`
- 6-character random short codes
- CloudFront caching for redirects

### OpenAIStack
- **Endpoint:** `POST /openai`
- API key stored in SSM Parameter Store (`/openai/api-key`)

## Lambda Development

### Standard Pattern
All Lambda handlers follow this structure:
```typescript
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  // Implementation
};
```

### Response Utilities
Use standardized responses from `resources/shared/utils/responseUtils.ts`:
```typescript
import { success, created, badRequest, serverError } from '../shared/utils/responseUtils';

// Returns 200 with data
return success({ data: result });

// Returns 400 for validation errors
return badRequest('Invalid input');

// Returns 500 for server errors
return serverError('Something went wrong');
```

### Lambda Configuration Defaults
- **Runtime:** Node.js 20.x (NODEJS_LATEST)
- **Architecture:** ARM64 (cost optimized)
- **Memory:** 128-512MB depending on workload
- **Timeout:** 15s-10min depending on use case
- **Log Retention:** 1 month

## Shared Services

### DynamoDbService (`resources/shared/services/dynamoDbClient.ts`)
```typescript
const dynamoDb = new DynamoDbService('TableName');
await dynamoDb.putItem(item);
await dynamoDb.getItem({ pk: 'value', sk: 'value' });
await dynamoDb.queryItems(params);
```

### SsmService (`resources/shared/services/ssmClient.ts`)
```typescript
const ssm = new SsmService();
const value = await ssm.getParameterValue('/path/to/param');
```

## Environment Variables

Required in `.env` for CDK deployment:
```
# Base API Configuration
BASE_DOMAIN_NAME=api.elevensys.dev
BASE_HOSTED_ZONE_ID=<Route53 zone ID>
BASE_CERTIFICATE_ARN=<ACM certificate ARN>

# Urlify Configuration
REDIRECT_DOMAIN_NAME=urlify.cc
API_HOSTED_ZONE_ID=<Route53 zone ID>
URLIFY_CERTIFICATE_ARN=<ACM cert ARN - must be us-east-1>

# CDK Configuration
CDK_DEFAULT_ACCOUNT=<AWS account ID>
CDK_DEFAULT_REGION=<AWS region>
```

## Testing

Tests are in the `test/` directory. Run with:
```bash
npm run test
```

Test files follow the pattern `*.test.ts`.

## CI/CD

GitHub Actions workflow (`.github/workflows/deploy.yml`):
- Triggered manually via workflow dispatch
- Supports deploying all stacks or a specific stack
- Uses GitHub Secrets for AWS credentials

## Key Design Patterns

1. **Microservices Architecture** - Independent stacks sharing base API
2. **Async Processing** - SQS fan-out for scalable job processing
3. **Exponential Backoff** - Retry logic for external API calls (Jira, etc.)
4. **TTL Management** - Auto-expiring records in DynamoDB
5. **Error Tracking** - Centralized error storage per job

## Important Files to Understand

| File | Purpose |
|------|---------|
| `bin/elevensys-cdk.ts` | Stack instantiation and dependencies |
| `lib/stacks/base-api-stack.ts` | Shared API Gateway configuration |
| `resources/shared/utils/responseUtils.ts` | Standardized API responses |
| `resources/shared/utils/httpUtils.ts` | HTTP client with retry logic |
| `resources/shared/models/types.ts` | Core TypeScript interfaces |

## Common Tasks

### Adding a New Lambda
1. Create folder in `resources/lambda/<name>-lambda/`
2. Add `index.ts` with handler function
3. Add Lambda construct in appropriate stack
4. Import shared utilities as needed

### Adding a New API Endpoint
1. Add Lambda function (see above)
2. In stack file, add resource and method to API Gateway
3. Use `api.root.addResource('path')` and `.addMethod('GET', lambdaIntegration)`

### Modifying DynamoDB Schema
1. Update type definitions in `resources/shared/models/`
2. Modify stack if table structure changes
3. Consider migration strategy for existing data

## Troubleshooting

- **CDK Deploy Fails:** Check AWS credentials and `.env` configuration
- **Lambda Timeout:** Check memory allocation and external API calls
- **CORS Issues:** Verify CORS headers in responseUtils and API Gateway config
- **SSL Errors:** Ensure certificate is in correct region (us-east-1 for CloudFront)

## Git Workflow

- Main development branch for features
- Clean commits with descriptive messages
- Run `npm run format` before committing
- Run `npm run build` to verify TypeScript compiles
