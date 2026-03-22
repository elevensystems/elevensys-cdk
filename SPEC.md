# Autolog Feature — Specification

## Overview

Autolog automates the repetitive task of logging work to Jira. Users configure which tickets to log per project (with fixed hours), set a weekly or monthly schedule, and the system runs automatically — filling in missing worklog dates and emailing a confirmation.

---

## Architecture

```
elevensys-web (Next.js)
  └── /timesheet/autolog page
      └── calls api.elevensys.dev/timesheet/autolog/* (CRUD)
          └── elevensys-core (Ts.ED Lambda)
              └── AutologController / AutologService
                  └── DynamoDB AutologTable

elevensys-cdk (CDK)
  └── CoreStack
      ├── AutologTable (DynamoDB)
      ├── SES EmailIdentity (elevensys.dev)
      └── AutologExecutorLambda
          └── EventBridge Rule: every 1 hour
              → scan DynamoDB directly (DynamoDBService)
              → retrieve Jira token from SSM (SsmService)
              → call Jira worklogs-warning API directly (sendRequest + createJiraHeaders)
              → call Jira logwork API for each missing date × ticket
              → send SES email summary
```

---

## Data Model

### DynamoDB — AutologTable

| Key | Value |
|-----|-------|
| PK  | `USER#{username}` |
| SK  | `CONFIG#{configId}` |

```typescript
{
  configId: string;        // UUID
  username: string;        // Jira username
  email: string;           // notification email (default: {username}@fpt.com)
  jiraInstance: string;    // 'jiradc' | 'jira3' | 'jira9'
  projectId: string;       // Jira project ID
  projectKey: string;      // e.g. "PROJ"
  projectName: string;     // display name
  tickets: Array<{
    issueKey: string;      // e.g. "PROJ-123"
    hours: number;         // e.g. 4
    description?: string;
  }>;
  schedule: {
    type: 'weekly' | 'monthly';
    dayOfWeek?: number;    // 0=Sun..6=Sat (weekly)
    dayOfMonth?: number;   // 1-31 (monthly)
    hour: number;          // 0-23 UTC
  };
  status: 'active' | 'paused_auth';
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastRunStatus?: 'success' | 'partial' | 'nothing_to_log' | 'failed';
}
```

### SSM Parameter Store

- Path: `/autolog/{username}/jira-token` (SecureString)
- Stored when user creates/updates a config
- Deleted when user deletes a config

---

## API Endpoints (elevensys-core)

All under `/timesheet/autolog`, protected by `BearerAuthMiddleware`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/timesheet/autolog` | List configs for the authenticated user (max 3) |
| POST | `/timesheet/autolog` | Create config — saves token to SSM |
| PUT | `/timesheet/autolog/:configId` | Update config — re-saves token to SSM |
| DELETE | `/timesheet/autolog/:configId` | Delete config + remove SSM token |
| POST | `/timesheet/autolog/:configId/run` | Manual trigger (run immediately) |

**Request body** (POST/PUT):
```json
{
  "username": "nguyen.van.a",
  "email": "nguyen.van.a@fpt.com",
  "jiraInstance": "jiradc",
  "projectId": "10001",
  "projectKey": "PROJ",
  "projectName": "My Project",
  "tickets": [
    { "issueKey": "PROJ-123", "hours": 4, "description": "Development" },
    { "issueKey": "PROJ-456", "hours": 4 }
  ],
  "schedule": {
    "type": "weekly",
    "dayOfWeek": 5,
    "hour": 9
  }
}
```

---

## Scheduler (elevensys-cdk)

- **Trigger**: EventBridge Rule, every hour
- **Lambda**: `AutologExecutorLambda`
- **Logic**:
  1. Scan `AutologTable` for all `active` configs
  2. Filter configs due this UTC hour:
     - **weekly**: `dayOfWeek === today.dayOfWeek && hour === now.hour`
     - **monthly**: `dayOfMonth === today.date && hour === now.hour`
  3. For each due config:
     - Get token from SSM
     - Call Jira `worklogs-warning` to get missing dates for the current period
     - For each missing date × each ticket:
       - Fetch issue to auto-detect `typeOfWork`
       - Call Jira `logwork` endpoint
     - Update `lastRunAt` + `lastRunStatus` in DynamoDB
     - Send SES email summary

- **Period**:
  - Weekly: Monday → Sunday of current week
  - Monthly: 1st → last day of current month

- **Reused utilities** (from `resources/shared/`):
  - `DynamoDBService` — scan + update
  - `SsmService` — getParameterValue
  - `createJiraHeaders`, `sendRequest` — Jira HTTP calls

---

## Email

### Success
- **Subject**: `[Autolog] {projectName} — {startDate} to {endDate}`
- **Body**: Dates logged, ticket breakdown (issueKey: Xh × N dates), link to timesheet

### Re-auth required
- **Subject**: `[Autolog] Action required — {projectName}`
- **Body**: Token expired, link to `/timesheet/autolog` to re-authenticate

### Nothing to log
- **Subject**: `[Autolog] {projectName} — nothing to log`
- **Body**: All worklogs already submitted for the period

---

## Frontend (elevensys-web)

### Route
`/timesheet/autolog` — dedicated page

### UI Flow
1. Page lists existing configs (cards), max 3 per user
2. **Add Config** → multi-step form:
   - Step 1: Select Jira project
   - Step 2: Search + select tickets, set hours + optional description per ticket
   - Step 3: Set schedule (weekly/monthly, day, hour)
   - Step 4: Confirm/edit notification email
3. Config card shows: project, tickets, schedule, status badge, last run info
4. Card actions: Edit, Delete, Run Now, Re-authenticate (when paused)

### Settings used
`useTimesheetSettings()` provides `{ username, token, jiraInstance }` — token is passed as Bearer when saving config (stored in SSM server-side for scheduled runs).

---

## Constraints

- Max 3 configs per user (enforced in elevensys-core service)
- Token expiry: detected via 401/403 from Jira → config paused, email sent
- Rate limiting: 500ms delay between logwork requests
- SES must be out of sandbox to send to `@fpt.com` addresses (one-time AWS Support request)
- `elevensys.dev` domain must be SES-verified (CDK creates identity + DNS records)
