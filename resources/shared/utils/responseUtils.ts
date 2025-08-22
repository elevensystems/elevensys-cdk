import { APIGatewayProxyResult } from 'aws-lambda';

export interface ErrorDetail {
  code?: string;
  detail?: string;
}

export interface ResponseBody {
  message: string;
  data?: any;
  errors?: ErrorDetail[];
}

/**
 * Creates a standardized API response
 * @param statusCode - HTTP status code
 * @param message - Main response message
 * @param data - Optional data to include in response
 * @param errors - Optional array of error details
 * @returns Formatted API Gateway response
 */
export function createResponse(
  statusCode: number,
  message: string,
  data?: any,
  errors?: ErrorDetail[]
): APIGatewayProxyResult {
  const body: ResponseBody = {
    message,
  };

  if (data) {
    body.data = data;
  }

  if (errors) {
    body.errors = errors;
  }

  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Credentials': true,
    },
    body: JSON.stringify(body),
  };
}

// Common response patterns
export const successResponse = (
  message: string = 'Success',
  data?: any
): APIGatewayProxyResult => createResponse(200, message, data);

export const createdResponse = (
  message: string = 'Created',
  data?: any
): APIGatewayProxyResult => createResponse(201, message, data);

export const badRequestResponse = (
  message: string = 'Bad Request',
  errors?: ErrorDetail[]
): APIGatewayProxyResult => createResponse(400, message, undefined, errors);

export const unauthorizedResponse = (
  message: string = 'Unauthorized'
): APIGatewayProxyResult => createResponse(401, message);

export const forbiddenResponse = (
  message: string = 'Forbidden'
): APIGatewayProxyResult => createResponse(403, message);

export const notFoundResponse = (
  message: string = 'Not Found'
): APIGatewayProxyResult => createResponse(404, message);

export const serverErrorResponse = (
  message: string = 'Internal Server Error',
  errors?: ErrorDetail[]
): APIGatewayProxyResult => createResponse(500, message, undefined, errors);
