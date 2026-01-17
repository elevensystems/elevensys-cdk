import { SQSEvent, SQSRecord } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  UpdateCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  sendRequest,
  createJiraHeaders,
  sleep,
} from '../../shared/utils/httpUtils';
import { getCurrentTime } from '../../shared/utils/dateUtils';
import { JiraInstance, TicketMessage } from '../../shared/models/types';

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;

function getTimesheetApiUrl(jiraInstance: JiraInstance): string {
  const apiUrl = `https://insight.fsoft.com.vn/${jiraInstance}/rest/tempo/1.0/log-work/create-log-work`;
  console.log(`Timesheet API URL for ${jiraInstance}: ${apiUrl}`);
  return apiUrl;
}

async function processRecord(record: SQSRecord): Promise<void> {
  try {
    const message: TicketMessage = JSON.parse(record.body);
    const { jobId, username, date, ticket, token, jiraInstance } = message;

    console.log(
      `Processing ticket ${ticket.ticketId} for date ${date}, job ${jobId}, jiraInstance: ${jiraInstance}`
    );

    const apiUrl = getTimesheetApiUrl(jiraInstance);
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
      timeSpend: parseFloat(ticket.timeSpend) * 3600,
      typeOfWork: ticket.typeOfWork,
      username,
    };

    await sendRequest(apiUrl, payload, headers);

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

    const message: TicketMessage = JSON.parse(record.body);
    const { jobId, ticket, date } = message;

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

export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    await processRecord(record);
    await sleep(1000);
  }
};
