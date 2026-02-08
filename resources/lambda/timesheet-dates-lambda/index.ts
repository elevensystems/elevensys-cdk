import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import axios from 'axios';
import { createJiraHeaders } from '../../shared/utils/httpUtils';
import { JiraInstance } from '../../shared/models/types';

/**
 * Timesheet Dates Lambda - Proxies GET requests to Jira API
 *
 * Fetches timesheet date information from Jira's plugin.
 * Maps to: GET /rest/tempo/1.0/user-worklogs/get-list-date
 *
 * Query Parameters:
 * - fromDate: Start date (e.g., "1/Feb/26")
 * - toDate: End date (e.g., "7/Feb/26")
 * - user: Jira username (e.g., "BaoHQ11")
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

    if (!params?.fromDate || !params?.toDate || !params?.user) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: 'Missing required query parameters: fromDate, toDate, user',
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
    const { fromDate, toDate, user } = params;
    const jiraInstance = (params.jiraInstance || 'jiradc') as JiraInstance;

    const baseUrl = `https://insight.fsoft.com.vn/${jiraInstance}/rest/tempo/1.0/user-worklogs/get-list-date`;
    const url = new URL(baseUrl);
    url.searchParams.set('fromDate', fromDate);
    url.searchParams.set('toDate', toDate);
    url.searchParams.set('user', user);

    // Forward any additional query parameters
    Object.entries(params).forEach(([key, value]) => {
      if (
        !['fromDate', 'toDate', 'user', 'jiraInstance'].includes(key) &&
        value
      ) {
        url.searchParams.set(key, value);
      }
    });

    const headers = createJiraHeaders(token, jiraInstance);

    console.log(`Fetching timesheet dates from: ${url.toString()}`);
    console.log(
      `User: ${user}, From: ${fromDate}, To: ${toDate}, Instance: ${jiraInstance}`
    );

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
    console.error('Timesheet dates proxy error:', error);

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
