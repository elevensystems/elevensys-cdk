# CLAUDE.md - AI Assistant Guide for elevensys-cdk

## Project Overview

**elevensys-cdk** is an AWS CDK infrastructure-as-code project written in TypeScript. It deploys a microservices platform with multiple integrated services:

- **Jira Timesheet Integration** - Proxy to Jira APIs for worklog management
- **URL Shortener (Urlify)** - URL shortening with click tracking and custom domain
- **OpenAI API Wrapper** - Proxied access to OpenAI's API

All services share a common API Gateway at `api.elevensys.dev`.

## Tech Stack

- **AWS CDK** - `aws-cdk-lib` 2.219.0 / `aws-cdk` CLI 2.1030.0
- **TypeScript 5.6.3** - Primary language
- **Node.js 20.x** - Runtime (Lambda functions)
- **AWS SDK v3** - DynamoDB, SQS, SSM clients (`^3.868.0`)
- **axios ^1.11.0** - HTTP client for Jira API proxy
- **openai ^6.16.0** - OpenAI SDK
- **uuid ^11.0.3** - UUID generation
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
│       ├── timesheet-core-stack.ts # Jira timesheet proxy + legacy processing
│       └── urlify-stack.ts      # URL shortener service
├── resources/
│   ├── lambda/                  # Lambda function implementations
│   │   ├── timesheet-proxy-lambda/   # Jira API proxy
│   │   ├── openai-lambda/            # OpenAI API proxy
│   │   ├── urlify-lambda/            # URL redirect handler
│   │   └── urlify-admin-lambda/      # URL management API
│   └── shared/                  # Shared code across lambdas
│       ├── constants/           # Shared constants
│       ├── models/              # TypeScript interfaces
│       │   ├── types.ts         # Core types (JiraInstance)
│       │   └── urlShortenerTypes.ts # UrlData interface
│       ├── services/            # AWS service wrappers
│       │   ├── dynamoDbClient.ts # DynamoDBService class
│       │   └── ssmClient.ts     # SsmService class
│       └── utils/               # Helper functions
│           ├── responseUtils.ts # Standardized API responses
│           ├── httpUtils.ts     # HTTP client with retry, Jira headers, parseBodyToJson
│           └── dateUtils.ts     # getCurrentTime, parseDates
├── test/                        # Jest unit tests
├── docs/                        # Documentation (API.md - full API reference)
├── scripts/                     # Scripts (placeholder)
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
- **Bracket spacing:** true
- **Arrow parens:** always

### TypeScript

- Strict mode enabled
- Target: ES2022
- Module: NodeNext
- Always use explicit types for function parameters and return values

### Naming Conventions

- **Files:** kebab-case (e.g., `base-api-stack.ts`, `job-creator-lambda`)
- **Classes:** PascalCase (e.g., `BaseApiStack`, `DynamoDBService`)
- **Functions/Variables:** camelCase
- **Constants:** UPPER_SNAKE_CASE for true constants
- **DynamoDB Keys:** PascalCase (e.g., `PK`, `SK`, `ShortCode`)

## CDK Stacks

### BaseApiStack (Foundation)

- Centralized REST API Gateway at `api.elevensys.dev`
- All other stacks attach their resources to this API
- Handles SSL certificate and Route53 DNS

### TimesheetCoreStack

- Single `timesheet-proxy-lambda` handles all Jira API routes
- Routes requests to Jira REST API based on HTTP method and path
- Requires `Authorization` header (Bearer token) forwarded to Jira

**Proxy Endpoints:**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/timesheet/auth` | Check authentication with Jira |
| `GET` | `/timesheet/worklogs` | Fetch user worklogs |
| `GET` | `/timesheet/project-worklogs` | Fetch project worklogs |
| `GET` | `/timesheet/project-worklogs/pagination` | Paginated project worklogs |
| `DELETE` | `/timesheet/project-worklogs/{issueId}/{timesheetId}` | Delete timesheet entry |
| `GET` | `/timesheet/timesheet-view` | Fetch timesheet calendar view |
| `GET` | `/timesheet/timesheet-dates` | Fetch timesheet dates |
| `POST` | `/timesheet/logwork` | Log work entry to Jira |
| `POST` | `/timesheet/project-worklogs-warning` | Project worklogs warning report |
| `GET` | `/timesheet/projects` | Fetch all Jira projects |
| `GET` | `/timesheet/projects/{projectId}` | Fetch a specific Jira project |
| `POST` | `/timesheet/projects` | Fetch issues using JQL payload |
| `GET` | `/timesheet/projects/{projectId}/issues` | Fetch issues for a project |
| `GET` | `/timesheet/issue/{issueId}` | Fetch a specific Jira issue |

All proxy endpoints accept `?jiraInstance=jiradc|jira3|jira9` query parameter.

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

### HTTP Utilities

From `resources/shared/utils/httpUtils.ts`:

```typescript
import { sendRequest, createJiraHeaders, parseBodyToJson, sleep } from '../shared/utils/httpUtils';

// POST with exponential backoff retry (handles 429 and 5xx)
const response = await sendRequest(url, payload, headers, maxRetries);

// Build Jira auth headers from Bearer token
const headers = createJiraHeaders(token, 'jiradc');

// Safely parse JSON body
const body = parseBodyToJson<MyType>(event.body);
```

### Lambda Configuration Defaults

- **Runtime:** Node.js 20.x (NODEJS_LATEST)
- **Architecture:** ARM64 (cost optimized)
- **Memory:** 256MB default
- **Timeout:** 30s for proxy
- **Tracing:** X-Ray active
- **Log Retention:** 1 month

## Shared Services

### DynamoDBService (`resources/shared/services/dynamoDbClient.ts`)

```typescript
import dynamoDBService from '../shared/services/dynamoDbClient';

// Default instance (no config)
await dynamoDBService.putItem('TableName', item);
await dynamoDBService.getItem('TableName', { pk: 'value' });
await dynamoDBService.queryItems('TableName', params);
await dynamoDBService.scanItems('TableName');
await dynamoDBService.deleteItem('TableName', { pk: 'value' });

// Custom instance
const custom = new DynamoDBService({ region: 'us-west-2' });
```

### SsmService (`resources/shared/services/ssmClient.ts`)

```typescript
const ssm = new SsmService();
const value = await ssm.getParameterValue('/path/to/param');
```

## Environment Variables

Required in `.env` for CDK deployment:

```bash
# AWS Account
CDK_DEFAULT_ACCOUNT=<AWS account ID>
CDK_DEFAULT_REGION=<AWS region>

# Base API Gateway (api.elevensys.dev)
BASE_DOMAIN_NAME=api.elevensys.dev
BASE_HOSTED_ZONE_ID=<Route53 zone ID>
BASE_CERTIFICATE_ARN=<ACM certificate ARN>

# Urlify URL Shortener
REDIRECT_DOMAIN_NAME=urlify.cc
API_HOSTED_ZONE_ID=<Route53 zone ID for urlify.cc>
URLIFY_CERTIFICATE_ARN=<ACM cert ARN - must be us-east-1>
```

## Testing

Tests are in the `test/` directory. Run with:

```bash
npm run test
```

Test files follow the pattern `*.test.ts`. Jest config: `ts-jest` transform, Node test environment.

## CI/CD

GitHub Actions workflow (`.github/workflows/deploy.yml`):
- Triggered manually via workflow dispatch
- **Inputs:**
  - `stack` (optional) - deploy a specific stack, or leave empty for all
  - `require_approval` (optional, default: false) - require manual approval before deployment
- Uses GitHub Secrets for AWS credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`)
- Runs on Node.js 20

## Key Design Patterns

1. **Microservices Architecture** - Independent stacks sharing base API
2. **API Proxy** - Single Lambda routing to external Jira APIs
3. **Exponential Backoff** - Retry logic with jitter for external API calls

## Important Files to Understand

| File | Purpose |
|------|---------|
| `bin/elevensys-cdk.ts` | Stack instantiation and dependencies |
| `lib/stacks/base-api-stack.ts` | Shared API Gateway configuration |
| `lib/stacks/timesheet-core-stack.ts` | Timesheet proxy architecture |
| `resources/lambda/timesheet-proxy-lambda/index.ts` | Route-based Jira API proxy |
| `resources/shared/utils/responseUtils.ts` | Standardized API responses |
| `resources/shared/utils/httpUtils.ts` | HTTP client with retry logic + Jira headers |
| `resources/shared/models/types.ts` | Core TypeScript interfaces |
| `docs/API.md` | Full API reference with all endpoints |

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

### Adding a New Proxy Route

1. Add route config to `ROUTES` record in `timesheet-proxy-lambda/index.ts`
2. Define method, required params, and `buildUrl` function
3. Add corresponding API Gateway resource/method in `timesheet-core-stack.ts`

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
