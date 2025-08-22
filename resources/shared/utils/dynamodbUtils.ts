import dynamoDBService from '../services/dynamoDbClient';
import { Ticket } from '../models/types';

export async function getAllTickets(): Promise<Ticket[]> {
  const tableName = process.env.TICKETS_TABLE_NAME;
  if (!tableName) {
    throw new Error('TICKETS_TABLE_NAME environment variable is not defined');
  }
  return await dynamoDBService.scanItems<Ticket>(tableName);
}

export async function getTicketById(
  ticketId: string
): Promise<Ticket | undefined> {
  const tableName = process.env.TICKETS_TABLE_NAME;
  if (!tableName) {
    throw new Error('TICKETS_TABLE_NAME environment variable is not defined');
  }
  return await dynamoDBService.getItem<Ticket>(tableName, { ticketId });
}

export async function createTicket(ticket: Ticket): Promise<Ticket> {
  const tableName = process.env.TICKETS_TABLE_NAME;
  if (!tableName) {
    throw new Error('TICKETS_TABLE_NAME environment variable is not defined');
  }
  await dynamoDBService.putItem(tableName, ticket);
  return ticket;
}

export async function updateTicket(ticket: Ticket): Promise<Ticket> {
  const tableName = process.env.TICKETS_TABLE_NAME;
  if (!tableName) {
    throw new Error('TICKETS_TABLE_NAME environment variable is not defined');
  }
  await dynamoDBService.putItem(tableName, ticket);
  return ticket;
}

export async function deleteTicket(ticketId: string): Promise<void> {
  const tableName = process.env.TICKETS_TABLE_NAME;
  if (!tableName) {
    throw new Error('TICKETS_TABLE_NAME environment variable is not defined');
  }
  await dynamoDBService.deleteItem(tableName, { ticketId });
}
