import axios from 'axios';

export async function sendRequest(
  url: string,
  payload: any,
  headers: any
): Promise<any> {
  console.log(`Send an HTTP request to: ${url}`);

  try {
    const response = await axios.post(url, payload, { headers });
    console.log(`Response [${response.status}]: ${response.data}`);
    return response;
  } catch (error) {
    console.error(`Request failed: ${error}`);
    throw error;
  }
}

export function createJiraHeaders(token: string): Record<string, string> {
  return {
    Connection: 'close',
    'Accept-Encoding': 'None',
    accept: 'application/json, text/javascript, */*; q=0.01',
    'accept-language': 'en-US,en;q=0.9,vi;q=0.8',
    'content-type': 'application/json',
    origin: 'https://insight.fsoft.com.vn',
    priority: 'u=0, i',
    referer: 'https://insight.fsoft.com.vn/jira9/browse/EONHOMEGRIDX-25',
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
