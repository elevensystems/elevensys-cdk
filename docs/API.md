# Elevensys CDK - API Reference

Base domain: `https://api.elevensys.dev`

---

## Timesheet Proxy

**Stack:** TimesheetCoreStack
**Handler:** `timesheet-proxy-lambda`

All endpoints require `Authorization: Bearer <token>` header.
All endpoints accept optional query parameter `?jiraInstance=jiradc|jira3|jira9` (defaults to `jiradc`).

| Method   | Path                                                  | Parameters                                              | Description                          |
| -------- | ----------------------------------------------------- | ------------------------------------------------------- | ------------------------------------ |
| `GET`    | `/timesheet/auth`                                     | —                                                       | Check authentication with Jira       |
| `GET`    | `/timesheet/worklogs`                                 | `fromDate`, `toDate`, `user` (required)                 | Fetch user worklogs for a date range |
| `GET`    | `/timesheet/project-worklogs`                         | `fromDate`, `toDate` (required)                         | Fetch project-level worklogs         |
| `GET`    | `/timesheet/project-worklogs/pagination`              | `fromDate`, `toDate` (required)                         | Paginated project-level worklogs     |
| `DELETE` | `/timesheet/project-worklogs/{issueId}/{timesheetId}` | `issueId`, `timesheetId` (path)                         | Delete a timesheet entry             |
| `GET`    | `/timesheet/timesheet-view`                           | `fromDate`, `toDate`, `user` (required)                 | Fetch timesheet calendar view        |
| `GET`    | `/timesheet/timesheet-dates`                          | `fromDate`, `toDate`, `user` (required)                 | Fetch timesheet date information     |
| `POST`   | `/timesheet/logwork`                                  | Body: `{issueKey, username, startDate, ...}`            | Log a work entry to Jira             |
| `POST`   | `/timesheet/project-worklogs-warning`                 | Body: `{pid, startDate, endDate, ...}`                  | Get project worklogs warning report  |
| `GET`    | `/timesheet/issue/{issueId}`                          | `issueId` (path)                                        | Fetch a specific Jira issue by ID    |
| `GET`    | `/timesheet/projects`                                 | —                                                       | Fetch all Jira projects              |
| `GET`    | `/timesheet/projects/{projectId}`                     | `projectId` (path)                                      | Fetch a specific Jira project by ID  |
| `POST`   | `/timesheet/projects`                                 | Body: `{jql, columnConfig, layoutKey, startIndex, ...}` | Fetch issues using JQL payload       |
| `GET`    | `/timesheet/projects/{projectId}/issues`              | `projectId` (path)                                      | Fetch issues for a specific project  |

---

## OpenAI

**Stack:** OpenAIStack
**Handler:** `openai-lambda`

| Method | Path      | Parameters                                                                                          | Description                                                    |
| ------ | --------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `POST` | `/openai` | Body: `{input (required), model?, instructions?, temperature?, max_output_tokens?, tools?, store?}` | OpenAI chat completions proxy. Model defaults to `gpt-5-nano`. |

---

## Urlify - Admin API

**Stack:** UrlifyStack
**Handler:** `urlify-admin-lambda`

| Method   | Path                        | Parameters                                                          | Description                          |
| -------- | --------------------------- | ------------------------------------------------------------------- | ------------------------------------ |
| `GET`    | `/urlify/health`            | —                                                                   | Health check                         |
| `POST`   | `/urlify/shorten`           | Body: `{originalUrl (required), createdBy?, ttlDays?, autoDelete?}` | Create a shortened URL               |
| `GET`    | `/urlify/stats/{shortCode}` | `shortCode` (path)                                                  | Get click statistics for a short URL |
| `GET`    | `/urlify/urls`              | `limit?` (default: 20), `lastKey?`                                  | List all shortened URLs (paginated)  |
| `DELETE` | `/urlify/url/{shortCode}`   | `shortCode` (path)                                                  | Delete a shortened URL               |

---

## Urlify - Redirect

**Domain:** `https://urlify.cc`
**Handler:** `urlify-lambda`

| Method | Path           | Description                                                                         |
| ------ | -------------- | ----------------------------------------------------------------------------------- |
| `GET`  | `/{shortCode}` | 301 redirect to original URL. Increments click count. Cached by CloudFront (5 min). |

---

## Summary

| Service          | Active Endpoints |
| ---------------- | ---------------- |
| Timesheet Proxy  | 14               |
| OpenAI           | 1                |
| Urlify Admin     | 5                |
| Urlify Redirect  | 1                |
| **Total**        | **21**           |
