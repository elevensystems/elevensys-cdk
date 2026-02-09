import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import axios, { Method } from 'axios';
import {
  createJiraHeaders,
  parseBodyToJson,
} from '../../shared/utils/httpUtils';
import { JiraInstance } from '../../shared/models/types';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

const JIRA_BASE = 'https://insight.fsoft.com.vn';

interface RouteConfig {
  method: Method;
  tempoPath: string;
  requiredQueryParams?: string[];
  requiredPathParams?: string[];
  requiredBodyFields?: string[];
  buildUrl: (jiraInstance: JiraInstance, event: APIGatewayProxyEvent) => string;
}

function forwardQueryParams(
  event: APIGatewayProxyEvent,
  baseUrl: string,
  exclude: string[] = ['jiraInstance']
): string {
  const url = new URL(baseUrl);
  const params = event.queryStringParameters || {};
  Object.entries(params).forEach(([key, value]) => {
    if (!exclude.includes(key) && value) {
      url.searchParams.set(key, value);
    }
  });
  return url.toString();
}

const ROUTES: Record<string, RouteConfig> = {
  'GET /timesheet/worklogs': {
    method: 'GET',
    tempoPath: 'user-worklogs/get-list',
    requiredQueryParams: ['fromDate', 'toDate', 'user'],
    buildUrl: (ji, event) => {
      const params = event.queryStringParameters!;
      const url = new URL(
        `${JIRA_BASE}/${ji}/rest/tempo/1.0/user-worklogs/get-list`
      );
      url.searchParams.set('fromDate', params.fromDate!);
      url.searchParams.set('toDate', params.toDate!);
      url.searchParams.set('user', params.user!);
      url.searchParams.set('statusWorklog', 'All');
      return url.toString();
    },
  },

  'GET /timesheet/project-worklogs': {
    method: 'GET',
    tempoPath: 'project-worklogs/get-list',
    requiredQueryParams: ['fromDate', 'toDate'],
    buildUrl: (ji, event) =>
      forwardQueryParams(
        event,
        `${JIRA_BASE}/${ji}/rest/tempo/1.0/project-worklogs/get-list`
      ),
  },

  'GET /timesheet/project-worklogs/pagination': {
    method: 'GET',
    tempoPath: 'project-worklogs/get-page-list',
    requiredQueryParams: ['fromDate', 'toDate'],
    buildUrl: (ji, event) =>
      forwardQueryParams(
        event,
        `${JIRA_BASE}/${ji}/rest/tempo/1.0/project-worklogs/get-page-list`
      ),
  },

  'DELETE /timesheet/project-worklogs/{issueId}/{timesheetId}': {
    method: 'DELETE',
    tempoPath: 'project-worklogs',
    requiredPathParams: ['issueId', 'timesheetId'],
    buildUrl: (ji, event) => {
      const { issueId, timesheetId } = event.pathParameters!;
      return `${JIRA_BASE}/${ji}/rest/tempo/1.0/project-worklogs/${issueId}/${timesheetId}`;
    },
  },

  'GET /timesheet/timesheet-view': {
    method: 'GET',
    tempoPath: 'user-worklogs/search-by-user',
    requiredQueryParams: ['fromDate', 'toDate', 'user'],
    buildUrl: (ji, event) => {
      const params = event.queryStringParameters!;
      const baseUrl = `${JIRA_BASE}/${ji}/rest/tempo/1.0/user-worklogs/search-by-user`;
      const url = new URL(baseUrl);
      url.searchParams.set('fromDate', params.fromDate!);
      url.searchParams.set('toDate', params.toDate!);
      url.searchParams.set('user', params.user!);
      // Forward any additional query parameters
      Object.entries(params).forEach(([key, value]) => {
        if (
          !['fromDate', 'toDate', 'user', 'jiraInstance'].includes(key) &&
          value
        ) {
          url.searchParams.set(key, value);
        }
      });
      return url.toString();
    },
  },

  'GET /timesheet/timesheet-dates': {
    method: 'GET',
    tempoPath: 'user-worklogs/get-list-date',
    requiredQueryParams: ['fromDate', 'toDate', 'user'],
    buildUrl: (ji, event) => {
      const params = event.queryStringParameters!;
      const baseUrl = `${JIRA_BASE}/${ji}/rest/tempo/1.0/user-worklogs/get-list-date`;
      const url = new URL(baseUrl);
      url.searchParams.set('fromDate', params.fromDate!);
      url.searchParams.set('toDate', params.toDate!);
      url.searchParams.set('user', params.user!);
      // Forward any additional query parameters
      Object.entries(params).forEach(([key, value]) => {
        if (
          !['fromDate', 'toDate', 'user', 'jiraInstance'].includes(key) &&
          value
        ) {
          url.searchParams.set(key, value);
        }
      });
      return url.toString();
    },
  },

  'POST /timesheet/logwork': {
    method: 'POST',
    tempoPath: 'log-work/create-log-work',
    requiredBodyFields: ['issueKey', 'username', 'startDate'],
    buildUrl: (ji) =>
      `${JIRA_BASE}/${ji}/rest/tempo/1.0/log-work/create-log-work`,
  },

  'POST /timesheet/project-worklogs-warning': {
    method: 'POST',
    tempoPath: 'project-my-worklogs-report/get-warning',
    requiredBodyFields: ['pid', 'startDate', 'endDate'],
    buildUrl: (ji) =>
      `${JIRA_BASE}/${ji}/rest/hunger/1.0/project-my-worklogs-report/get-warning`,
  },

  'GET /timesheet/projects': {
    method: 'GET',
    tempoPath: 'project',
    buildUrl: (ji) => `${JIRA_BASE}/${ji}/rest/api/2/project`,
  },

  'GET /timesheet/projects/{projectId}': {
    method: 'GET',
    tempoPath: 'project/{projectId}',
    requiredPathParams: ['projectId'],
    buildUrl: (ji, event) => {
      const { projectId } = event.pathParameters!;
      return `${JIRA_BASE}/${ji}/rest/api/2/project/${projectId}`;
    },
  },
};

function resolveRoute(event: APIGatewayProxyEvent): RouteConfig | undefined {
  const key = `${event.httpMethod} ${event.resource}`;
  return ROUTES[key];
}

function errorResponse(
  statusCode: number,
  error: string
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error }),
  };
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  try {
    // 1. Auth extraction
    const authHeader =
      event.headers['Authorization'] || event.headers['authorization'];
    if (!authHeader) {
      return errorResponse(401, 'Missing Authorization header');
    }
    const token = authHeader.replace('Bearer ', '');

    // 2. Route resolution
    const route = resolveRoute(event);
    if (!route) {
      return errorResponse(
        404,
        `Unknown route: ${event.httpMethod} ${event.resource}`
      );
    }

    // 3. Validate required query params
    if (route.requiredQueryParams) {
      const params = event.queryStringParameters || {};
      const missing = route.requiredQueryParams.filter((p) => !params[p]);
      if (missing.length > 0) {
        return errorResponse(
          400,
          `Missing required query parameters: ${missing.join(', ')}`
        );
      }
    }

    // 4. Validate required path params
    if (route.requiredPathParams) {
      const pathParams = event.pathParameters || {};
      const missing = route.requiredPathParams.filter((p) => !pathParams[p]);
      if (missing.length > 0) {
        return errorResponse(
          400,
          `Missing required path parameters: ${missing.join(', ')}`
        );
      }
    }

    // 5. Validate required body fields (POST routes)
    let body: any = null;
    if (route.requiredBodyFields) {
      body = parseBodyToJson(event.body);
      if (!body) {
        return errorResponse(400, 'Missing or invalid request body');
      }
      const missing = route.requiredBodyFields.filter((f) => !body[f]);
      if (missing.length > 0) {
        return errorResponse(
          400,
          `Missing required fields: ${missing.join(', ')}`
        );
      }
    }

    // 6. Build URL and execute request
    const jiraInstance = (event.queryStringParameters?.jiraInstance ||
      'jiradc') as JiraInstance;
    const url = route.buildUrl(jiraInstance, event);
    const headers = createJiraHeaders(token, jiraInstance);

    console.log(`[${route.method}] ${url}`);

    let response;
    if (route.method === 'POST') {
      body = body || parseBodyToJson(event.body);
      response = await axios.post(url, body, { headers, timeout: 15000 });
    } else if (route.method === 'DELETE') {
      response = await axios.delete(url, { headers, timeout: 15000 });
    } else {
      response = await axios.get(url, { headers, timeout: 15000 });
    }

    console.log(`Response status: ${response.status}`);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, data: response.data }),
    };
  } catch (error: any) {
    console.error('Proxy error:', error);

    const statusCode = error.response?.status || 500;
    const errorMessage =
      error.response?.data || error.message || 'Internal server error';

    return {
      statusCode,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error:
          typeof errorMessage === 'string'
            ? errorMessage
            : JSON.stringify(errorMessage),
        status: statusCode,
      }),
    };
  }
};
