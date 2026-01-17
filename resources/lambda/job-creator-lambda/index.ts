import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { v7 as uuidv7 } from 'uuid';
import { parseDates } from '../../shared/utils/dateUtils';
import {
  successResponse,
  badRequestResponse,
  serverErrorResponse,
} from '../../shared/utils/responseUtils';
import {
  CreateJobRequest,
  TicketMessage,
  JobStatus,
} from '../../shared/models/types';

enum JiraInstance {
  JIRA3 = 'jira3',
  JIRA9 = 'jira9',
  JIRADC = 'jiradc',
}

const sqsClient = new SQSClient({});
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const QUEUE_URL = process.env.QUEUE_URL!;
const TABLE_NAME = process.env.TABLE_NAME!;

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    if (!event.body) {
      return badRequestResponse('Missing request body');
    }

    const authHeader =
      event.headers?.Authorization || event.headers?.authorization;
    if (!authHeader) {
      return badRequestResponse('Missing Authorization header');
    }

    const token = authHeader.startsWith('Bearer ')
      ? authHeader.substring(7)
      : authHeader;

    if (!token) {
      return badRequestResponse('Invalid Authorization header format');
    }

    const body = JSON.parse(event.body) as CreateJobRequest;
    const { username, dates: rawDates, tickets, jiraInstance } = body;

    // Validation
    if (!username) {
      return badRequestResponse('Missing required field: username');
    }

    if (!rawDates) {
      return badRequestResponse('Missing required field: dates');
    }

    if (!jiraInstance) {
      return badRequestResponse('Missing required field: jiraInstance');
    }

    if (
      jiraInstance !== JiraInstance.JIRA3 &&
      jiraInstance !== JiraInstance.JIRA9 &&
      jiraInstance !== JiraInstance.JIRADC
    ) {
      return badRequestResponse(
        'Invalid jiraInstance: must be, "jira3", "jira9", or "jiradc"'
      );
    }

    if (!tickets || !Array.isArray(tickets)) {
      return badRequestResponse(
        'Missing or invalid tickets: must provide a tickets array'
      );
    }

    if (tickets.length === 0) {
      return badRequestResponse(
        'Empty tickets array: at least one ticket is required'
      );
    }

    const invalidTickets = tickets.filter(
      (ticket) =>
        !ticket.ticketId ||
        !ticket.timeSpend ||
        !ticket.description ||
        !ticket.typeOfWork
    );

    if (invalidTickets.length > 0) {
      return badRequestResponse(
        'Invalid ticket format: each ticket must have ticketId, timeSpend, description, and typeOfWork'
      );
    }

    const dates = parseDates(rawDates);
    const jobId = uuidv7();
    const totalTasks = dates.length * tickets.length;
    const createdAt = new Date().toISOString();

    const jobStatus: JobStatus = {
      jobId,
      total: totalTasks,
      processed: 0,
      failed: 0,
      status: 'in-progress',
      createdAt,
      errors: [],
    };

    await dynamoClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: jobStatus,
      })
    );

    const sendPromises = [];
    for (const date of dates) {
      for (const ticket of tickets) {
        const message: TicketMessage = {
          jobId,
          username,
          date,
          ticket,
          token,
          jiraInstance,
        };

        sendPromises.push(
          sqsClient.send(
            new SendMessageCommand({
              QueueUrl: QUEUE_URL,
              MessageBody: JSON.stringify(message),
              MessageGroupId: jobId,
            })
          )
        );
      }
    }

    await Promise.all(sendPromises);

    console.log(
      `Job ${jobId} created with ${totalTasks} tasks for user ${username}`
    );

    return successResponse('Job created successfully. Processing started.', {
      jobId,
      total: totalTasks,
    });
  } catch (error) {
    console.error('Error creating job:', error);
    return serverErrorResponse();
  }
};
