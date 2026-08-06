# CLAUDE.md - AI Assistant Guide for elevensys-cdk

## Project Overview

**elevensys-cdk** is an AWS CDK infrastructure-as-code project written in TypeScript. This repo only defines two stacks — `BaseApiStack` (the shared API Gateway) and `CoreStack` (a single Lambda, `CoreLambda`, that proxies every service route). All actual request-handling logic lives in the external sibling repo **elevensys-core**, which `CoreStack` pulls in as a pre-built Lambda asset (see `ELEVENSYS_CORE_PATH` in `core-stack.ts`). `CoreStack` fronts:

- **Jira Timesheet Integration** - `/jira/*` proxy to Jira APIs for worklog management
- **URL Shortener (Urlify)** - `/urlify/*` admin API plus the `urlify.cc` redirect domain
- **OpenAI API Wrapper** - `/openai` proxied access to OpenAI's API
- **Audit** - `/audit/*`

All routes share the common API Gateway at `api.elevensys.dev`. There used to be standalone `TimesheetCoreStack`, `UrlifyStack`, and `OpenAIStack` constructs with their own Lambdas under `resources/lambda/` in this repo — they were removed once `CoreStack`/elevensys-core took over all routing. Any change to service behavior now happens in the `elevensys-core` repo, not here.

## Tech Stack

- **AWS CDK** - `aws-cdk-lib` 2.219.0 / `aws-cdk` CLI 2.1030.0
- **TypeScript 5.6.3** - Primary language
- **Node.js 22.x** - Runtime (`CoreLambda`, `AutologExecutorLambda`)
- **AWS SDK v3** - DynamoDB, SQS, SSM clients (`^3.868.0`)
- **Jest 29.7.0** - Testing framework

## Directory Structure

```
elevensys-cdk/
├── .claude/                      # Claude Code configuration
│   ├── agents/                   # Custom AI agents
│   │   └── cdk-review.md        # CDK audit agent (readability, performance, best practices)
│   ├── skills/                   # Reusable AI skills
│   │   ├── aws-cdk/             # AWS CDK expert skill + references
│   │   ├── git-skill/           # Git workflow skill + references
│   │   └── explain-code/        # Code explanation skill
│   ├── settings.json            # Shared Claude Code settings
│   └── settings.local.json      # Local-only Claude Code settings (gitignored)
├── bin/                          # CDK app entry point
│   └── elevensys-cdk.ts         # Main application - stack orchestration
├── lib/
│   └── stacks/                  # CDK stack definitions
│       ├── base-api-stack.ts    # Shared API Gateway (api.elevensys.dev)
│       └── core-stack.ts        # CoreLambda (serves /jira, /openai, /urlify, /audit + autolog)
├── test/                        # Jest unit tests
├── docs/                        # Documentation (API.md - full API reference)
├── scripts/                     # Scripts (placeholder)
└── .github/workflows/           # CI/CD (deploy.yml, checks out elevensys-core as a sibling dir)
```

> Note: there is no `resources/` directory in this repo. `CoreStack` loads its Lambda code from the sibling `elevensys-core` repository (resolved via `ELEVENSYS_CORE_PATH`, default `../../../elevensys-core`), not from local source — see `core-stack.ts`.

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

### CoreStack

A single `CoreLambda` (code from the external `elevensys-core` repo) is proxied
onto the shared API Gateway for every service prefix — `jira`, `openai`,
`urlify`, `audit` — via `ANY /{prefix}` and
`ANY /{prefix}/{proxy+}`. All request routing, auth, and business logic
happens inside elevensys-core's own app, not in this CDK repo. There used to
be standalone `TimesheetCoreStack` and `UrlifyStack` constructs with their own
Lambdas (`timesheet-proxy-lambda`, `urlify-lambda`, `urlify-admin-lambda`) —
both were removed once `CoreStack` absorbed their routing. See `docs/API.md`
for the endpoint reference (kept for historical/consumer documentation, actual
implementation lives in elevensys-core).

- **Jira Timesheet** (`/jira/*`) — proxy to Jira REST API; requires
  `Authorization: Bearer <token>` forwarded to Jira, `?jiraInstance=jiradc|jira3|jira9`
- **Urlify** (`/urlify/*` admin API + `urlify.cc/{shortCode}` redirect) — 6-character
  short codes, `UrlifyTable` DynamoDB table (GSI `EntityTypeCreatedAtIndex`), CloudFront
  caching for redirects via a dedicated `UrlifyRedirectApi` + `UrlifyRedirectDistribution`
- **OpenAI** (`POST /openai`) — API key stored in SSM Parameter Store
  (`/openai/api-key`), read by `CoreStack` and injected as `OPENAI_API_KEY`
- **Audit** (`/audit/*`)
- **Autolog** — `AutologExecutorLambda` (also code from `elevensys-core`),
  triggered hourly via EventBridge (`AutologHourlyRule`), not exposed as an
  HTTP route. Uses `AutologTable` and SSM params under `/autolog/*`.

## Lambda Development

There is no Lambda handler source in this repo. `CoreLambda` and
`AutologExecutorLambda` (defined in `lib/stacks/core-stack.ts`) both load
their compiled code from the external `elevensys-core` repo via
`lambda.Code.fromAsset(ELEVENSYS_CORE_PATH, ...)`. Handler code, request
routing, response utilities, HTTP clients, and DynamoDB/SSM service wrappers
all live in `elevensys-core`, not here — go there to change Lambda behavior.

### Lambda Configuration Defaults (in `core-stack.ts`)

- **Runtime:** Node.js 22.x (`Runtime.NODEJS_22_X`)
- **Architecture:** ARM64 (cost optimized)
- **Tracing:** X-Ray active
- **Log Retention:** 1 month (dedicated log groups per Lambda)

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

1. **Two-stack architecture** - `BaseApiStack` (shared API Gateway) + `CoreStack` (single proxy Lambda), all business logic delegated to the external `elevensys-core` repo
2. **API Proxy** - `CoreLambda` handles every service prefix (`jira`, `openai`, `urlify`, `audit`) via `ANY {proxy+}` integrations
3. **Asset-based deployment** - `CoreStack` bundles `elevensys-core`'s pre-built `dist/` output directly (`lambda.Code.fromAsset`), no local `NodejsFunction` bundling

## Important Files to Understand

| File | Purpose |
|------|---------|
| `bin/elevensys-cdk.ts` | Stack instantiation and dependencies |
| `lib/stacks/base-api-stack.ts` | Shared API Gateway configuration |
| `lib/stacks/core-stack.ts` | CoreLambda/AutologExecutorLambda, DynamoDB tables, all API routes, urlify.cc redirect |
| `docs/API.md` | Full API reference with all endpoints |
| `../elevensys-core` (sibling repo) | Actual Lambda handler code, routing, and business logic |

## Common Tasks

### Adding a New API Endpoint / Changing Service Behavior

New endpoints and routing logic are added in the external `elevensys-core`
repo, not here. In this repo you only need to touch `core-stack.ts` if you're
adding a brand-new top-level route prefix (extend the proxy-prefix loop) or a
new AWS resource (table, permission, env var) that `CoreLambda` needs.

### Modifying DynamoDB Schema

1. Update the table construct (`UrlifyTable`, `AutologTable`) in `lib/stacks/core-stack.ts` if key/GSI structure changes
2. Update the corresponding type definitions in `elevensys-core`
3. Consider migration strategy for existing data

## Troubleshooting

- **CDK Deploy Fails:** Check AWS credentials and `.env` configuration
- **Lambda Timeout:** Check memory allocation and external API calls
- **CORS Issues:** Verify CORS headers in elevensys-core's response utilities and API Gateway config
- **SSL Errors:** Ensure certificate is in correct region (us-east-1 for CloudFront)
- **Lambda Code Not Updating:** Ensure `elevensys-core` is checked out as a sibling directory (or `ELEVENSYS_CORE_PATH` is set) and built (`npm run build`) before `cdk deploy`/`cdk synth`

## Claude Code Configuration

The `.claude/` directory contains project-level Claude Code configuration committed to the repo.

### Agents (`.claude/agents/`)

Custom subagents invoked automatically by Claude Code for specialized tasks:

| Agent | Trigger | Purpose |
|-------|---------|---------|
| `cdk-review` | "review my CDK project", "audit this stack", "find CDK issues" | Full CDK audit across readability, performance, and best practices — produces a prioritized report with fixes |

### Skills (`.claude/skills/`)

Reusable skill files that load domain knowledge into Claude's context:

| Skill | Trigger | Purpose |
|-------|---------|---------|
| `aws-cdk` | Any CDK task (stacks, constructs, resources) | Expert CDK patterns, references for Lambda, networking, storage, security, pipelines |
| `git-skill` | Any Git operation | Safe Git workflows, branching, commits, conflict resolution |
| `explain-code` | "how does this work?", explaining code | Code explanations with diagrams and analogies |

### Settings

- **`settings.json`** — Shared project settings (committed, applies to all contributors)
- **`settings.local.json`** — Local overrides (not committed, personal preferences)

## Git Workflow

- Main development branch for features
- Clean commits with descriptive messages
- Run `npm run format` before committing
- Run `npm run build` to verify TypeScript compiles
