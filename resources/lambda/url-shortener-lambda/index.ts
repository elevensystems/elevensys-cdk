import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  UpdateItemCommand,
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

import { randomBytes } from 'crypto';

// Initialize DynamoDB Client
const dynamoDbClient = new DynamoDBClient({});
const TABLE_NAME = process.env.URL_SHORTENER_TABLE_NAME!;

// Constants
const TTL_DAYS = 30;
const SHORT_CODE_LENGTH = 6;
const BASE_URL = process.env.BASE_URL || 'https://short.url';

/**
 * Interface for URL data structure
 */
interface UrlData {
  PK: string;
  SK: string;
  ShortCode: string;
  OriginalUrl: string;
  Clicks: number;
  LastAccessed?: number;
  CreatedAt: number;
  CreatedBy?: string;
  TTL: number;
  EntityType: string;
}

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
 * Calculate TTL timestamp (30 days from now)
 */
function calculateTTL(): number {
  return Math.floor(Date.now() / 1000) + TTL_DAYS * 24 * 60 * 60;
}

/**
 * Create a shortened URL
 */
async function createShortUrl(
  originalUrl: string,
  createdBy?: string
): Promise<UrlData> {
  // Validate URL
  if (!isValidUrl(originalUrl)) {
    throw new Error('Invalid URL format');
  }

  const shortCode = generateShortCode();
  const now = Date.now();
  const ttl = calculateTTL();

  const urlData: UrlData = {
    PK: `URL#${shortCode}`,
    SK: 'METADATA',
    ShortCode: shortCode,
    OriginalUrl: originalUrl,
    Clicks: 0,
    CreatedAt: now,
    TTL: ttl,
    EntityType: 'URL',
  };

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
 * Increment click count and update last accessed timestamp
 */
async function incrementClicks(shortCode: string): Promise<void> {
  await dynamoDbClient.send(
    new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({
        PK: `URL#${shortCode}`,
        SK: 'METADATA',
      }),
      UpdateExpression:
        'SET Clicks = if_not_exists(Clicks, :zero) + :inc, LastAccessed = :timestamp',
      ExpressionAttributeValues: marshall({
        ':inc': 1,
        ':zero': 0,
        ':timestamp': Date.now(),
      }),
    })
  );
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
        ConditionExpression: 'attribute_exists(PK)', // Ensure item exists
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
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    const httpMethod = event.httpMethod;
    const path = event.path;
    const pathParameters = event.pathParameters || {};

    // Health check endpoint
    if (httpMethod === 'GET' && path === '/health') {
      return successResponse('Service is healthy', {
        status: 'ok',
        timestamp: new Date().toISOString(),
      });
    }

    // POST /api/shorten - Create shortened URL
    if (httpMethod === 'POST' && path === '/api/shorten') {
      const body = parseBodyToJson(event.body);

      if (!body || !body.originalUrl) {
        return badRequestResponse('Missing required field: originalUrl', [
          { code: 'MISSING_FIELD', detail: 'Original URL is required' },
        ]);
      }

      const { originalUrl, createdBy } = body;

      try {
        const urlData = await createShortUrl(originalUrl, createdBy);

        return createdResponse('URL shortened successfully', {
          shortCode: urlData.ShortCode,
          shortUrl: `${BASE_URL}/${urlData.ShortCode}`,
          originalUrl: urlData.OriginalUrl,
          createdAt: new Date(urlData.CreatedAt).toISOString(),
          expiresAt: new Date(urlData.TTL * 1000).toISOString(),
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

    // GET /:shortCode - Redirect to original URL
    if (
      httpMethod === 'GET' &&
      pathParameters.shortCode &&
      !path.includes('/api/')
    ) {
      const { shortCode } = pathParameters;

      const urlData = await getUrlByShortCode(shortCode);

      if (!urlData) {
        return notFoundResponse(`Short URL not found: ${shortCode}`);
      }

      // Increment click count asynchronously (don't wait for it)
      incrementClicks(shortCode).catch((err) =>
        console.error('Error incrementing clicks:', err)
      );

      // Return 301 redirect
      return {
        statusCode: 301,
        headers: {
          Location: urlData.OriginalUrl,
          'Cache-Control': 'no-cache',
        },
        body: '',
      };
    }

    // GET /api/stats/:shortCode - Get URL statistics
    if (httpMethod === 'GET' && path.includes('/api/stats/')) {
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
        expiresAt: new Date(urlData.TTL * 1000).toISOString(),
        createdBy: urlData.CreatedBy,
      });
    }

    // GET /api/urls - List all URLs (paginated)
    if (httpMethod === 'GET' && path === '/api/urls') {
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
        expiresAt: new Date(item.TTL * 1000).toISOString(),
      }));

      return successResponse('URLs retrieved successfully', {
        urls,
        count: urls.length,
        lastEvaluatedKey: result.lastEvaluatedKey,
      });
    }

    // DELETE /api/url/:shortCode - Delete a shortened URL
    if (httpMethod === 'DELETE' && path.includes('/api/url/')) {
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

    // If no route matched
    return notFoundResponse(`Endpoint not found: ${httpMethod} ${path}`);
  } catch (error) {
    console.error('Error in URL shortener operation:', error);
    return serverErrorResponse(
      'An error occurred while processing your request',
      [{ detail: error instanceof Error ? error.message : 'Unknown error' }]
    );
  }
};
