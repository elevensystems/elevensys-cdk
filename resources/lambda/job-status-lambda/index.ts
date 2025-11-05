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

    // Calculate progress percentage
    const progress =
      jobStatus.total > 0
        ? Math.round(
            ((jobStatus.processed + jobStatus.failed) / jobStatus.total) * 100
          )
        : 0;

    console.log(
      JSON.stringify({
        msg: 'job status retrieved',
        jobId,
        total: (jobStatus as any).total,
        processed: (jobStatus as any).processed,
        failed: (jobStatus as any).failed,
        progress,
      })
    );

    return successResponse('Job status retrieved successfully', {
      ...jobStatus,
      progress,
    });
  } catch (error) {
    console.error('Error retrieving job status:', error);
    return serverErrorResponse();
  }
};
