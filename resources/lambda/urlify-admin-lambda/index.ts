import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  DeleteItemCommand,
  ScanCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  successResponse,
  createdResponse,
  badRequestResponse,
  notFoundResponse,
  serverErrorResponse,
} from '../../shared/utils/responseUtils';
import { parseBodyToJson } from '../../shared/utils/httpUtils';
import { withCors } from '../../shared/utils/corsUtils';
import { UrlData } from '../../shared/models/urlShortenerTypes';

import { randomBytes } from 'crypto';

// Initialize DynamoDB Client
const dynamoDbClient = new DynamoDBClient({});
const TABLE_NAME = process.env.URLIFY_TABLE_NAME!;

// Constants
const SHORT_CODE_LENGTH = 6;
const BASE_URL = process.env.BASE_URL || 'https://short.url';
const DEFAULT_TTL_DAYS = 30;

/**
 * Generate a random short code
 */
function generateShortCode(length = SHORT_CODE_LENGTH): string {
  return randomBytes(length)
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '')
    .substring(0, length);
}

/**
 * Validate URL format
 */
function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Calculate TTL timestamp (days from now)
 */
function calculateTTL(days: number): number {
  return Math.floor(Date.now() / 1000) + days * 24 * 60 * 60;
}

/**
 * Create a shortened URL
 */
async function createShortUrl(
  originalUrl: string,
  createdBy?: string,
  ttlDays?: number
): Promise<UrlData> {
  // Validate URL
  if (!isValidUrl(originalUrl)) {
    throw new Error('Invalid URL format');
  }

  const shortCode = generateShortCode();
  const now = Date.now();
  const urlData: UrlData = {
    PK: `URL#${shortCode}`,
    SK: 'METADATA',
    ShortCode: shortCode,
    OriginalUrl: originalUrl,
    Clicks: 0,
    CreatedAt: now,
    EntityType: 'URL',
  };

  if (ttlDays && ttlDays > 0) {
    urlData.TTL = calculateTTL(ttlDays);
  }

  if (createdBy) {
    urlData.CreatedBy = createdBy;
  }

  // Store in DynamoDB
  await dynamoDbClient.send(
    new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall(urlData),
      ConditionExpression: 'attribute_not_exists(PK)', // Ensure no collision
    })
  );

  return urlData;
}

/**
 * Get URL data by short code
 */
async function getUrlByShortCode(shortCode: string): Promise<UrlData | null> {
  const result = await dynamoDbClient.send(
    new GetItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({
        PK: `URL#${shortCode}`,
        SK: 'METADATA',
      }),
    })
  );

  if (!result.Item) {
    return null;
  }

  return unmarshall(result.Item) as UrlData;
}

/**
 * List all URLs with pagination
 */
async function listUrls(limit: number = 20, lastEvaluatedKey?: any) {
  const params: any = {
    TableName: TABLE_NAME,
    Limit: limit,
    FilterExpression: 'EntityType = :entityType',
    ExpressionAttributeValues: marshall({
      ':entityType': 'URL',
    }),
  };

  if (lastEvaluatedKey) {
    params.ExclusiveStartKey = lastEvaluatedKey;
  }

  const result = await dynamoDbClient.send(new ScanCommand(params));

  return {
    items: result.Items?.map((item) => unmarshall(item)) || [],
    lastEvaluatedKey: result.LastEvaluatedKey,
  };
}

/**
 * Delete a shortened URL
 */
async function deleteUrl(shortCode: string): Promise<boolean> {
  try {
    await dynamoDbClient.send(
      new DeleteItemCommand({
        TableName: TABLE_NAME,
        Key: marshall({
          PK: `URL#${shortCode}`,
          SK: 'METADATA',
        }),
        ConditionExpression: 'attribute_exists(PK)',
      })
    );
    return true;
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') {
      return false;
    }
    throw error;
  }
}

/**
 * Lambda handler for URL shortener operations
 * @param event API Gateway event
 * @returns API Gateway response
 */
export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    console.log('Event:', JSON.stringify(event, null, 2));

    try {
      const httpMethod = event.httpMethod;
      const resource = event.resource || '';
      const pathParameters = event.pathParameters || {};
      const normalizedResource = resource.replace(/^\/urlify/, '');

      if (httpMethod === 'GET' && normalizedResource === '/health') {
        return successResponse('Service is healthy', {
          status: 'ok',
          timestamp: new Date().toISOString(),
        });
      }

      if (httpMethod === 'POST' && normalizedResource === '/shorten') {
        const body = parseBodyToJson(event.body);

        if (!body || !body.originalUrl) {
          return badRequestResponse('Missing required field: originalUrl', [
            { code: 'MISSING_FIELD', detail: 'Original URL is required' },
          ]);
        }

        const { originalUrl, createdBy, autoDelete, ttlDays } = body;

        if (
          ttlDays !== undefined &&
          (typeof ttlDays !== 'number' || ttlDays <= 0)
        ) {
          return badRequestResponse('Invalid ttlDays value', [
            {
              code: 'INVALID_TTL_DAYS',
              detail: 'ttlDays must be a positive number of days',
            },
          ]);
        }

        if (autoDelete !== undefined && typeof autoDelete !== 'boolean') {
          return badRequestResponse('Invalid autoDelete value', [
            {
              code: 'INVALID_AUTO_DELETE',
              detail: 'autoDelete must be a boolean',
            },
          ]);
        }

        const resolvedTtlDays = autoDelete
          ? (ttlDays ?? DEFAULT_TTL_DAYS)
          : undefined;

        try {
          const urlData = await createShortUrl(
            originalUrl,
            createdBy,
            resolvedTtlDays
          );

          const expiresAt = urlData.TTL
            ? new Date(urlData.TTL * 1000).toISOString()
            : undefined;

          return createdResponse('URL shortened successfully', {
            shortCode: urlData.ShortCode,
            shortUrl: `${BASE_URL}/${urlData.ShortCode}`,
            originalUrl: urlData.OriginalUrl,
            createdAt: new Date(urlData.CreatedAt).toISOString(),
            ...(expiresAt ? { expiresAt } : {}),
          });
        } catch (error: any) {
          if (error.message === 'Invalid URL format') {
            return badRequestResponse('Invalid URL format', [
              { code: 'INVALID_URL', detail: 'Please provide a valid URL' },
            ]);
          }
          throw error;
        }
      }

      if (httpMethod === 'GET' && normalizedResource.startsWith('/stats/')) {
        const { shortCode } = pathParameters;

        if (!shortCode) {
          return badRequestResponse('Missing short code', [
            { code: 'MISSING_PARAM', detail: 'Short code is required' },
          ]);
        }

        const urlData = await getUrlByShortCode(shortCode);

        if (!urlData) {
          return notFoundResponse(`Short URL not found: ${shortCode}`);
        }

        return successResponse('URL statistics retrieved successfully', {
          shortCode: urlData.ShortCode,
          originalUrl: urlData.OriginalUrl,
          clicks: urlData.Clicks,
          createdAt: new Date(urlData.CreatedAt).toISOString(),
          lastAccessed: urlData.LastAccessed
            ? new Date(urlData.LastAccessed).toISOString()
            : null,
          ...(urlData.TTL
            ? { expiresAt: new Date(urlData.TTL * 1000).toISOString() }
            : {}),
          createdBy: urlData.CreatedBy,
        });
      }

      if (httpMethod === 'GET' && normalizedResource === '/urls') {
        const queryParams = event.queryStringParameters || {};
        const limit = parseInt(queryParams.limit || '20');
        const lastKey = queryParams.lastKey
          ? JSON.parse(queryParams.lastKey)
          : undefined;

        const result = await listUrls(limit, lastKey);

        const urls = result.items.map((item: any) => ({
          shortCode: item.ShortCode,
          shortUrl: `${BASE_URL}/${item.ShortCode}`,
          originalUrl: item.OriginalUrl,
          clicks: item.Clicks,
          createdAt: new Date(item.CreatedAt).toISOString(),
          lastAccessed: item.LastAccessed
            ? new Date(item.LastAccessed).toISOString()
            : null,
          ...(item.TTL
            ? { expiresAt: new Date(item.TTL * 1000).toISOString() }
            : {}),
        }));

        return successResponse('URLs retrieved successfully', {
          urls,
          count: urls.length,
          lastEvaluatedKey: result.lastEvaluatedKey,
        });
      }

      if (httpMethod === 'DELETE' && normalizedResource.startsWith('/url/')) {
        const { shortCode } = pathParameters;

        if (!shortCode) {
          return badRequestResponse('Missing short code', [
            { code: 'MISSING_PARAM', detail: 'Short code is required' },
          ]);
        }

        const deleted = await deleteUrl(shortCode);

        if (!deleted) {
          return notFoundResponse(`Short URL not found: ${shortCode}`);
        }

        return successResponse('URL deleted successfully', {
          shortCode,
          deleted: true,
        });
      }

      return notFoundResponse(
        `Endpoint not found: ${httpMethod} ${normalizedResource || resource}`
      );
    } catch (error) {
      console.error('Error in URL shortener operation:', error);
      return serverErrorResponse(
        'An error occurred while processing your request',
        [{ detail: error instanceof Error ? error.message : 'Unknown error' }]
      );
    }
  }
);
