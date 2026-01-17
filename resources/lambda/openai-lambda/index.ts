import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Lambda handler for OpenAI Responses API
 *
 * This function accepts requests via API Gateway and forwards them to OpenAI's Responses API.
 *
 * Expected request body:
 * {
 *   "input": "Your message here",  // Can also be an array of items/messages
 *   "model": "gpt-5-nano",  // Optional, defaults to "gpt-5-nano"
 *   "instructions": "You are a helpful assistant.",  // Optional system instructions
 *   "temperature": 0.7,     // Optional
 *   "max_output_tokens": 1000,  // Optional
 *   "tools": []  // Optional, e.g., [{ "type": "web_search" }]
 * }
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  try {
    if (!event.body) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Request body is required' }),
      };
    }

    const requestBody = JSON.parse(event.body);
    const {
      input,
      model,
      instructions,
      temperature,
      max_output_tokens,
      tools,
      store = true,
    } = requestBody;

    if (!input) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'input field is required (string or array of items/messages)',
        }),
      };
    }

    const response = await client.responses.create({
      model: model || 'gpt-5-nano',
      input: input,
      instructions: instructions,
      temperature: temperature || 1,
      max_output_tokens: max_output_tokens,
      tools: tools,
      store: store,
    });

    console.log('OpenAI response:', JSON.stringify(response, null, 2));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: response,
        output_text: response.output_text,
      }),
    };
  } catch (error: any) {
    console.error('Error calling OpenAI API:', error);

    if (error?.status) {
      return {
        statusCode: error.status,
        headers,
        body: JSON.stringify({
          error: error.message || 'OpenAI API error',
          details: error.error || {},
        }),
      };
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error.message || 'Unknown error occurred',
      }),
    };
  }
};
