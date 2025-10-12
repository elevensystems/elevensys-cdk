import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { notFoundResponse } from '../../shared/utils/responseUtils';
import { UrlData } from '../../shared/models/urlShortenerTypes';

// Initialize DynamoDB Client
const dynamoDbClient = new DynamoDBClient({});
const TABLE_NAME = process.env.URLIFY_TABLE_NAME!;

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
 * Lambda handler for URL redirection
 * Handles GET /:shortCode - Redirect to original URL
 * @param event API Gateway event
 * @returns API Gateway response with 301 redirect
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('Redirect Event:', JSON.stringify(event, null, 2));

  try {
    const pathParameters = event.pathParameters || {};
    const { shortCode } = pathParameters;

    // Validate short code exists
    if (!shortCode) {
      return notFoundResponse('Short code is required');
    }

    // Get URL data from DynamoDB
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
  } catch (error) {
    console.error('Error in URL redirect operation:', error);

    // Return a generic 404 for any errors to avoid exposing internals
    return notFoundResponse('Short URL not found');
  }
};
