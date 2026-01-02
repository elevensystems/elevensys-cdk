import axios from 'axios';
import { JiraInstance } from '../models/types';

/**
 * Sleep for a specified number of milliseconds
 * @param ms The number of milliseconds to sleep
 */
export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send an HTTP POST request with retry logic for rate limiting and server errors
 * @param url The URL to send the request to
 * @param payload The payload to send in the request body
 * @param headers The headers to include in the request
 * @param maxRetries The maximum number of retries (default: 10)
 * @returns The response from the server
 */
export async function sendRequest(
  url: string,
  payload: any,
  headers: any,
  maxRetries: number = 10
): Promise<any> {
  console.log(`Send an HTTP request to: ${url}`);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.post(url, payload, {
        headers,
        timeout: 15000, // 15 second timeout per request
      });
      console.log(`Response [${response.status}]: ${response.data}`);
      return response;
    } catch (error: any) {
      const isRateLimitError = error.response?.status === 429;
      const isServerError = error.response?.status >= 500;
      const shouldRetry =
        (isRateLimitError || isServerError) && attempt < maxRetries;

      if (!shouldRetry) {
        console.error(`Request failed after ${attempt + 1} attempts: ${error}`);
        throw error;
      }

      // Exponential backoff with jitter
      const baseDelay = Math.min(1000 * Math.pow(2, attempt), 30000); // Max 30 seconds
      const jitter = Math.random() * 1000; // Add 0-1 second random jitter
      const delay = baseDelay + jitter;

      console.warn(
        `Rate limited (429) or server error. Attempt ${attempt + 1}/${maxRetries}. Retrying in ${Math.round(delay)}ms...`
      );

      await sleep(delay);
    }
  }

  throw new Error('Max retries exceeded');
}

export function createJiraHeaders(
  token: string,
  jiraSystem: JiraInstance = 'jira9'
): Record<string, string> {
  return {
    Connection: 'close',
    'Accept-Encoding': 'None',
    accept: 'application/json, text/javascript, */*; q=0.01',
    'accept-language': 'en-US,en;q=0.9,vi;q=0.8',
    'content-type': 'application/json',
    origin: 'https://insight.fsoft.com.vn',
    priority: 'u=0, i',
    referer: `https://insight.fsoft.com.vn/${jiraSystem}/browse/EONHOMEGRIDX-25`,
    'sec-ch-ua':
      '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': 'macOS',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': 'None',
    'x-requested-with': 'XMLHttpRequest',
    authorization: `Bearer ${token}`,
  };
}

/**
 * Parses a JSON string to an object
 * @param body The JSON string to parse
 * @returns The parsed object or null if parsing fails
 */
export function parseBodyToJson<T = any>(
  body: string | null | undefined
): T | null {
  if (!body) {
    return null;
  }

  try {
    return JSON.parse(body) as T;
  } catch (error) {
    console.error('Error parsing JSON body:', error);
    return null;
  }
}
