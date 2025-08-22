import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { parseDates } from '../../shared/utils/dateUtils';
import { getJiraApiUrl } from '../../shared/utils/ssmUtils';
import { sendRequest, createJiraHeaders } from '../../shared/utils/httpUtils';
import { getCurrentTime } from '../../shared/utils/dateUtils';
import {
  successResponse,
  badRequestResponse,
  serverErrorResponse,
} from '../../shared/utils/responseUtils';
import { TimesheetRequest } from '../../shared/models/types';
import payloadTemplate from './payload.json';
import { getAllTickets } from '../../shared/utils/dynamodbUtils';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    if (!event.body) {
      return badRequestResponse('Missing request body');
    }

    const { username, token } = event.headers;
    if (!username || !token) {
      return badRequestResponse('Missing username or token in headers');
    }

    const body = JSON.parse(event.body) as TimesheetRequest;
    const dates = parseDates(body.dates);

    const apiUrl = await getJiraApiUrl();
    const tickets = await getAllTickets();
    const headers = createJiraHeaders(token);

    for (const date of dates) {
      for (const ticket of tickets) {
        const currentTime = getCurrentTime();

        const payload = {
          ...payloadTemplate,
          username,
          issueKey: ticket.ticketId,
          timeSpend: parseInt(ticket.timeSpend) * 3600,
          description: ticket.description,
          typeOfWork: ticket.typeOfWork,
          startDate: date,
          endDate: date,
          time: currentTime,
        };

        console.log(
          `Sending request for ${ticket.ticketId} on ${date} at ${currentTime}`
        );

        await sendRequest(apiUrl, payload, headers);
      }
    }

    return successResponse('Timesheet logging process started.');
  } catch (error) {
    console.error(error);
    return serverErrorResponse();
  }
};
