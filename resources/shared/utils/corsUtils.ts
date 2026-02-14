import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const ALLOWED_ORIGINS: string[] = [
  'https://satio.dev',
  'https://elevensystems.dev',
];

/**
 * Resolves the allowed origin from the request's Origin header.
 * Returns the origin if it matches the allowlist, otherwise undefined.
 */
function resolveOrigin(
  event: APIGatewayProxyEvent
): string | undefined {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  return ALLOWED_ORIGINS.includes(origin) ? origin : undefined;
}

/**
 * Builds CORS response headers for the given request.
 * Only sets Access-Control-Allow-Origin if the request origin is in the allowlist.
 * Always includes Vary: Origin to ensure correct caching behavior with CDNs/proxies.
 */
export function getCorsHeaders(
  event: APIGatewayProxyEvent
): Record<string, string> {
  const origin = resolveOrigin(event);

  return {
    ...(origin
      ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Credentials': 'true',
        }
      : {}),
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-Amz-Date, X-Api-Key, X-Amz-Security-Token',
    Vary: 'Origin',
  };
}

/**
 * Higher-order function that wraps a Lambda handler to automatically apply
 * CORS headers to all responses. This centralizes CORS handling so individual
 * handlers don't need to manage CORS headers directly.
 *
 * - Handles OPTIONS preflight requests automatically
 * - Adds CORS headers to all success and error responses
 * - Catches unhandled errors and still returns proper CORS headers
 */
export function withCors(
  handler: (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>
): (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult> {
  return async (
    event: APIGatewayProxyEvent
  ): Promise<APIGatewayProxyResult> => {
    const corsHeaders = getCorsHeaders(event);

    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 204,
        headers: corsHeaders,
        body: '',
      };
    }

    try {
      const response = await handler(event);
      return {
        ...response,
        headers: {
          ...response.headers,
          ...corsHeaders,
        },
      };
    } catch (error) {
      console.error('Unhandled error in Lambda handler:', error);
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
        body: JSON.stringify({ error: 'Internal server error' }),
      };
    }
  };
}
