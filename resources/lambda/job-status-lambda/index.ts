import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import {
  successResponse,
  badRequestResponse,
  notFoundResponse,
  serverErrorResponse,
} from '../../shared/utils/responseUtils';
import { JobStatus } from '../../shared/models/types';

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    console.log(
      JSON.stringify({
        msg: 'job-status invoked',
        requestId: event.requestContext?.requestId,
        path: event.path,
        query: event.queryStringParameters,
        table: TABLE_NAME,
      })
    );

    const jobId = event.queryStringParameters?.jobId;

    if (!jobId) {
      return badRequestResponse('Missing required query parameter: jobId');
    }

    // Retrieve job status from DynamoDB
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { jobId },
      })
    );

    if (!result.Item) {
      console.warn(
        JSON.stringify({
          msg: 'job not found',
          jobId,
        })
      );
      return notFoundResponse(`Job ${jobId} not found`);
    }

    const jobStatus = result.Item as JobStatus;

    // Ensure all required fields exist with defaults
    const total = jobStatus.total || 0;
    const processed = jobStatus.processed || 0;
    const failed = jobStatus.failed || 0;
    const status = jobStatus.status || 'unknown';
    const errors = jobStatus.errors || [];

    // Calculate progress percentage
    const progress =
      total > 0 ? Math.round(((processed + failed) / total) * 100) : 0;

    console.log(
      JSON.stringify({
        msg: 'job status retrieved',
        jobId,
        total,
        processed,
        failed,
        progress,
        status,
      })
    );

    return successResponse('Job status retrieved successfully', {
      jobId,
      total,
      processed,
      failed,
      status,
      progress,
      errors,
      createdAt: jobStatus.createdAt,
      updatedAt: jobStatus.updatedAt,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        msg: 'Error retrieving job status',
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      })
    );
    return serverErrorResponse();
  }
};
