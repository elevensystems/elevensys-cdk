import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Ticket } from '../../shared/models/types';
import {
  getAllTickets,
  getTicketById,
  createTicket,
  updateTicket,
  deleteTicket,
} from '../../shared/utils/dynamodbUtils';
import {
  successResponse,
  createdResponse,
  badRequestResponse,
  notFoundResponse,
  serverErrorResponse,
} from '../../shared/utils/responseUtils';
import { parseBodyToJson } from '../../shared/utils/httpUtils';

/**
 * Lambda handler for ticket CRUD operations
 * @param event API Gateway event
 * @returns API Gateway response
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    // Determine the operation based on HTTP method and path parameters
    const httpMethod = event.httpMethod;
    const pathParameters = event.pathParameters || {};
    const ticketId = pathParameters.ticketId;

    // GET /tickets - Get all tickets
    if (httpMethod === 'GET' && !ticketId) {
      const tickets = await getAllTickets();
      return successResponse('Tickets retrieved successfully', tickets);
    }

    // GET /tickets/{ticketId} - Get ticket by ID
    if (httpMethod === 'GET' && ticketId) {
      const ticket = await getTicketById(ticketId);
      if (!ticket) {
        return notFoundResponse(`Ticket with ID ${ticketId} not found`);
      }
      return successResponse('Ticket retrieved successfully', ticket);
    }

    // POST /tickets - Create a new ticket
    if (httpMethod === 'POST' && !ticketId) {
      const body = parseBodyToJson(event.body);
      if (
        !body ||
        !body.ticketId ||
        !body.timeSpend ||
        !body.description ||
        !body.typeOfWork
      ) {
        return badRequestResponse('Missing required ticket fields');
      }

      const newTicket: Ticket = {
        ticketId: body.ticketId,
        timeSpend: body.timeSpend,
        description: body.description,
        typeOfWork: body.typeOfWork,
      };

      const createdTicket = await createTicket(newTicket);
      return createdResponse('Ticket created successfully', createdTicket);
    }

    // PUT /tickets/{ticketId} - Update a ticket
    if (httpMethod === 'PUT' && ticketId) {
      // Check if ticket exists
      const existingTicket = await getTicketById(ticketId);
      if (!existingTicket) {
        return notFoundResponse(`Ticket with ID ${ticketId} not found`);
      }

      const body = parseBodyToJson(event.body);
      if (!body) {
        return badRequestResponse('Missing request body');
      }

      const updatedTicket: Ticket = {
        ticketId,
        timeSpend: body.timeSpend || existingTicket.timeSpend,
        description: body.description || existingTicket.description,
        typeOfWork: body.typeOfWork || existingTicket.typeOfWork,
      };

      await updateTicket(updatedTicket);
      return successResponse('Ticket updated successfully', updatedTicket);
    }

    // DELETE /tickets/{ticketId} - Delete a ticket
    if (httpMethod === 'DELETE' && ticketId) {
      // Check if ticket exists
      const existingTicket = await getTicketById(ticketId);
      if (!existingTicket) {
        return notFoundResponse(`Ticket with ID ${ticketId} not found`);
      }

      await deleteTicket(ticketId);
      return successResponse(`Ticket with ID ${ticketId} deleted successfully`);
    }

    // If we reach here, the requested operation is not supported
    return badRequestResponse('Unsupported operation');
  } catch (error) {
    console.error('Error in ticket CRUD operation:', error);
    return serverErrorResponse(
      'An error occurred while processing your request',
      [{ detail: error instanceof Error ? error.message : 'Unknown error' }]
    );
  }
};
