import { SQSEvent, SQSRecord } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  UpdateCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import { getTimesheetApiUrl } from '../../shared/utils/ssmUtils';
import {
  sendRequest,
  createJiraHeaders,
  sleep,
} from '../../shared/utils/httpUtils';
import { getCurrentTime } from '../../shared/utils/dateUtils';
import { TicketMessage } from '../../shared/models/types';

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;

export const handler = async (event: SQSEvent): Promise<void> => {
  const apiUrl = await getTimesheetApiUrl();

  for (const record of event.Records) {
    await processRecord(record, apiUrl);
  }
};

async function processRecord(record: SQSRecord, apiUrl: string): Promise<void> {
  try {
    const message: TicketMessage = JSON.parse(record.body);
    const { jobId, username, date, ticket, token } = message;

    console.log(
      `Processing ticket ${ticket.ticketId} for date ${date}, job ${jobId}`
    );

    const currentTime = getCurrentTime();
    const headers = createJiraHeaders(token);

    const payload = {
      description: ticket.description,
      endDate: date,
      issueKey: ticket.ticketId,
      period: false,
      remainingTime: 0,
      startDate: date,
      time: ` ${currentTime}`,
      timeSpend: parseFloat(ticket.timeSpend) * 3600, // Convert hours (string) to seconds
      typeOfWork: ticket.typeOfWork,
      username,
    };

    await sleep(1000);

    // Submit the ticket
    await sendRequest(apiUrl, payload, headers);

    // Update DynamoDB: increment processed count
    await dynamoClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { jobId },
        UpdateExpression:
          'SET #processed = #processed + :inc, updatedAt = :now',
        ExpressionAttributeNames: {
          '#processed': 'processed',
        },
        ExpressionAttributeValues: {
          ':inc': 1,
          ':now': new Date().toISOString(),
        },
      })
    );

    // Check if job is complete
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { jobId },
      })
    );

    if (result.Item) {
      const { total, processed, failed } = result.Item;
      if (processed + failed >= total) {
        // Mark job as complete
        await dynamoClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { jobId },
            UpdateExpression: 'SET #status = :status, updatedAt = :now',
            ExpressionAttributeNames: {
              '#status': 'status',
            },
            ExpressionAttributeValues: {
              ':status': failed > 0 ? 'failed' : 'completed',
              ':now': new Date().toISOString(),
            },
          })
        );
      }
    }

    console.log(
      `Successfully processed ticket ${ticket.ticketId} for date ${date}`
    );
  } catch (error) {
    console.error('Error processing ticket:', error);

    // Extract job info from message
    const message: TicketMessage = JSON.parse(record.body);
    const { jobId, ticket, date } = message;

    // Update DynamoDB: increment failed count and add error
    await dynamoClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { jobId },
        UpdateExpression:
          'SET #failed = #failed + :inc, updatedAt = :now, #errors = list_append(if_not_exists(#errors, :empty_list), :error)',
        ExpressionAttributeNames: {
          '#failed': 'failed',
          '#errors': 'errors',
        },
        ExpressionAttributeValues: {
          ':inc': 1,
          ':now': new Date().toISOString(),
          ':empty_list': [],
          ':error': [
            {
              ticketId: ticket.ticketId,
              date,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
          ],
        },
      })
    );

    // Check if job is complete (even with failures)
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { jobId },
      })
    );

    if (result.Item) {
      const { total, processed, failed } = result.Item;
      if (processed + failed >= total) {
        await dynamoClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { jobId },
            UpdateExpression: 'SET #status = :status, updatedAt = :now',
            ExpressionAttributeNames: {
              '#status': 'status',
            },
            ExpressionAttributeValues: {
              ':status': 'failed',
              ':now': new Date().toISOString(),
            },
          })
        );
      }
    }
  }
}
