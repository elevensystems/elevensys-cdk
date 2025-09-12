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
// import { getAllTickets } from '../../shared/utils/dynamodbUtils';

// Wait time between consecutive requests (ms) except after the final request
const WAIT_BETWEEN_REQUESTS_MS = 2000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    if (!event.body) {
      return badRequestResponse('Missing request body');
    }

    const body = JSON.parse(event.body) as TimesheetRequest;
    const { username, token, dates: rawDates, tickets } = body;
    // Check each field individually for more specific error messages
    if (!username) {
      return badRequestResponse('Missing required field: username');
    }

    if (!token) {
      return badRequestResponse('Missing required field: token');
    }

    if (!rawDates) {
      return badRequestResponse('Missing required field: dates');
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

    // Validate ticket structure
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

    const apiUrl = await getJiraApiUrl();
    // const tickets = await getAllTickets();
    const headers = createJiraHeaders(token);

    const totalRequests = dates.length * tickets.length;
    let processed = 0;

    for (const date of dates) {
      for (const ticket of tickets) {
        const currentTime = getCurrentTime();

        const payload = {
          remainingTime: 0,
          period: false,
          username,
          issueKey: ticket.ticketId,
          timeSpend: parseInt(ticket.timeSpend) * 3600,
          description: ticket.description,
          typeOfWork: ticket.typeOfWork,
          startDate: date,
          endDate: date,
          time: ` ${currentTime}`,
        };

        console.log(
          `Sending request for ${ticket.ticketId} on ${date} at ${currentTime}`
        );

        await sendRequest(apiUrl, payload, headers);

        processed += 1;
        // Wait only if there are more requests to send
        if (processed < totalRequests) {
          await sleep(WAIT_BETWEEN_REQUESTS_MS);
        }
      }
    }

    return successResponse('Timesheet logging process started.');
  } catch (error) {
    console.error(error);
    return serverErrorResponse();
  }
};
