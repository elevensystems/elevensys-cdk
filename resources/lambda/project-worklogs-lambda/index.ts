import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import axios from 'axios';
import { createJiraHeaders } from '../../shared/utils/httpUtils';
import { JiraInstance } from '../../shared/models/types';

/**
 * Project Worklogs Lambda - Proxies GET requests to Jira API
 *
 * Fetches project-level worklogs from Jira's plugin.
 * Maps to: GET /rest/tempo/1.0/project-worklogs/get-list
 *
 * Query Parameters:
 * - fromDate: Start date (e.g., "1/Feb/26")
 * - toDate: End date (e.g., "7/Feb/26")
 * - projectKey: Jira project key (e.g., "PROJ")
 * - page: Page number (optional, default: 1)
 * - jiraInstance: Jira instance key (e.g., "jiradc", "jira9", "jira3")
 *
 * Headers:
 * - Authorization: Bearer token for Jira authentication
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const params = event.queryStringParameters;

    if (!params?.fromDate || !params?.toDate) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: 'Missing required query parameters: fromDate, toDate',
        }),
      };
    }

    const authHeader =
      event.headers['Authorization'] || event.headers['authorization'];

    if (!authHeader) {
      return {
        statusCode: 401,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Missing Authorization header' }),
      };
    }

    const token = authHeader.replace('Bearer ', '');
    const jiraInstance = (params.jiraInstance || 'jiradc') as JiraInstance;

    const baseUrl = `https://insight.fsoft.com.vn/${jiraInstance}/rest/tempo/1.0/project-worklogs/get-list`;
    const url = new URL(baseUrl);

    // Forward all query parameters except jiraInstance
    Object.entries(params).forEach(([key, value]) => {
      if (key !== 'jiraInstance' && value) {
        url.searchParams.set(key, value);
      }
    });

    const headers = createJiraHeaders(token, jiraInstance);

    console.log(`Fetching project worklogs from: ${url.toString()}`);

    const response = await axios.get(url.toString(), {
      headers,
      timeout: 15000,
    });

    console.log(`Jira API response status: ${response.status}`);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        data: response.data,
      }),
    };
  } catch (error: any) {
    console.error('Project worklogs proxy error:', error);

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
