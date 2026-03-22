import axios from 'axios';
import {
  SESClient,
  SendEmailCommand,
} from '@aws-sdk/client-ses';
import { DynamoDBService } from '../../shared/services/dynamoDbClient.js';
import { SSMService } from '../../shared/services/ssmClient.js';
import { createJiraHeaders, sleep } from '../../shared/utils/httpUtils.js';
import type { JiraInstance } from '../../shared/models/types.js';

const TABLE_NAME = process.env.AUTO_LOGWORK_TABLE_NAME!;
const APP_URL = process.env.APP_URL || 'https://elevensys.dev';
const JIRA_BASE = 'https://insight.fsoft.com.vn';
const FROM_EMAIL = 'auto-logwork@elevensys.dev';
const REQUEST_DELAY_MS = 500;

const db = new DynamoDBService();
const ssm = new SSMService();
const ses = new SESClient({});

// ---- Types ----------------------------------------------------------------

interface AutoLogworkTicket {
  issueKey: string;
  hours: number;
  description?: string;
}

interface AutoLogworkSchedule {
  type: 'weekly' | 'monthly';
  dayOfWeek?: number;
  dayOfMonth?: number;
  hour: number;
}

interface AutoLogworkConfig {
  PK: string;
  SK: string;
  configId: string;
  username: string;
  email: string;
  jiraInstance: JiraInstance;
  projectId: string;
  projectKey: string;
  projectName: string;
  tickets: AutoLogworkTicket[];
  schedule: AutoLogworkSchedule;
  status: 'active' | 'paused_auth';
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastRunStatus?: 'success' | 'partial' | 'nothing_to_log' | 'failed';
}

// ---- Date helpers ---------------------------------------------------------

function getMondayOfWeek(d: Date): Date {
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff)
  );
}

function getMonthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function getMonthEnd(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}

function formatDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getPeriod(config: AutoLogworkConfig, now: Date): { startDate: string; endDate: string } {
  if (config.schedule.type === 'weekly') {
    const monday = getMondayOfWeek(now);
    return {
      startDate: formatDate(monday),
      endDate: formatDate(addDays(monday, 6)),
    };
  }
  return {
    startDate: formatDate(getMonthStart(now)),
    endDate: formatDate(getMonthEnd(now)),
  };
}

function isDue(config: AutoLogworkConfig, now: Date): boolean {
  const { schedule } = config;
  if (schedule.hour !== now.getUTCHours()) return false;
  if (schedule.type === 'weekly') {
    return schedule.dayOfWeek === now.getUTCDay();
  }
  return schedule.dayOfMonth === now.getUTCDate();
}

// ---- Jira helpers ---------------------------------------------------------

async function getMissingDates(
  config: AutoLogworkConfig,
  token: string,
  startDate: string,
  endDate: string
): Promise<string[]> {
  const ji = config.jiraInstance;
  const url = `${JIRA_BASE}/${ji}/rest/hunger/1.0/project-my-worklogs-report/get-warning`;
  const headers = createJiraHeaders(token, ji);

  try {
    const res = await axios.post(
      url,
      { pid: config.projectId, startDate, endDate },
      { headers, timeout: 25000 }
    );
    const data: Array<{ value?: string }> = res.data ?? [];
    return data.map((e) => e.value).filter(Boolean) as string[];
  } catch (err: any) {
    const status = err.response?.status;
    if (status === 401 || status === 403) {
      throw Object.assign(new Error('Jira auth expired'), { authError: true });
    }
    throw err;
  }
}

async function getTypeOfWork(
  issueKey: string,
  ji: JiraInstance,
  token: string
): Promise<string | undefined> {
  try {
    const url = `${JIRA_BASE}/${ji}/rest/api/2/issue/${issueKey}`;
    const headers = createJiraHeaders(token, ji);
    const res = await axios.get(url, { headers, timeout: 15000 });
    return res.data?.fields?.customfield_10400 as string | undefined;
  } catch {
    return undefined;
  }
}

async function logWork(
  ticket: AutoLogworkTicket,
  date: string,
  username: string,
  ji: JiraInstance,
  token: string,
  typeOfWork: string | undefined
): Promise<{ success: boolean; error?: string }> {
  const url = `${JIRA_BASE}/${ji}/rest/tempo/1.0/log-work/create-log-work`;
  const headers = createJiraHeaders(token, ji);
  const now = new Date();
  const time = ` ${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}:00`;

  try {
    await axios.post(
      url,
      {
        issueKey: ticket.issueKey,
        username,
        startDate: date,
        endDate: date,
        timeSpend: ticket.hours * 3600,
        description: ticket.description ?? '',
        typeOfWork: typeOfWork ?? '',
        time,
        remainingTime: 0,
        period: false,
      },
      { headers, timeout: 25000 }
    );
    return { success: true };
  } catch (err: any) {
    return {
      success: false,
      error: err.response?.data
        ? JSON.stringify(err.response.data)
        : err.message,
    };
  }
}

// ---- DynamoDB helpers -----------------------------------------------------

async function updateConfigStatus(
  config: AutoLogworkConfig,
  patch: Partial<AutoLogworkConfig>
): Promise<void> {
  await db.putItem(TABLE_NAME, { ...config, ...patch, updatedAt: new Date().toISOString() });
}

// ---- SES email helpers ----------------------------------------------------

async function sendEmail(to: string, subject: string, htmlBody: string): Promise<void> {
  try {
    await ses.send(
      new SendEmailCommand({
        Source: FROM_EMAIL,
        Destination: { ToAddresses: [to] },
        Message: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: { Html: { Data: htmlBody, Charset: 'UTF-8' } },
        },
      })
    );
  } catch (err) {
    console.error('Failed to send email to', to, err);
  }
}

function buildSuccessEmail(
  config: AutoLogworkConfig,
  startDate: string,
  endDate: string,
  loggedDates: string[],
  results: Array<{ issueKey: string; successCount: number; totalDates: number; hours: number }>
): string {
  const datesHtml =
    loggedDates.length > 0
      ? loggedDates.map((d) => `<li>${d}</li>`).join('')
      : '<li>No missing dates found — all worklogs already submitted.</li>';

  const ticketsHtml = results
    .map(
      (r) =>
        `<tr><td>${r.issueKey}</td><td>${r.hours}h × ${r.successCount}/${r.totalDates} dates = ${(r.hours * r.successCount).toFixed(1)}h logged</td></tr>`
    )
    .join('');

  return `
<html><body style="font-family:sans-serif;color:#333">
<h2>Auto Logwork — ${config.projectName}</h2>
<p>Period: <strong>${startDate}</strong> to <strong>${endDate}</strong></p>
<h3>Dates logged:</h3>
<ul>${datesHtml}</ul>
${
  results.length > 0
    ? `<h3>Tickets:</h3>
<table border="1" cellpadding="6" style="border-collapse:collapse">
  <tr><th>Ticket</th><th>Result</th></tr>
  ${ticketsHtml}
</table>`
    : ''
}
<p><a href="${APP_URL}/timesheet/logwork">View Timesheet</a></p>
</body></html>`;
}

function buildReauthEmail(config: AutoLogworkConfig): string {
  return `
<html><body style="font-family:sans-serif;color:#333">
<h2>Action Required — Auto Logwork</h2>
<p>Your Jira token for project <strong>${config.projectName}</strong> has expired or is invalid.</p>
<p>Auto logwork has been <strong>paused</strong> for this configuration.</p>
<p><a href="${APP_URL}/auto-logwork">Re-authenticate here</a> to resume automatic logging.</p>
</body></html>`;
}

// ---- Main handler ---------------------------------------------------------

export const handler = async (): Promise<void> => {
  const now = new Date();
  console.log(`Auto logwork executor started at ${now.toISOString()}`);

  const configs = await db.scanItems<AutoLogworkConfig>(TABLE_NAME, {
    FilterExpression: '#s = :active',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':active': 'active' },
  });

  const dueConfigs = configs.filter((c) => isDue(c, now));
  console.log(`Found ${dueConfigs.length} configs due this hour`);

  for (const config of dueConfigs) {
    console.log(`Processing config ${config.configId} for user ${config.username}`);

    // 1. Get Jira token from SSM
    let token: string;
    try {
      token = await ssm.getParameterValue(`/auto-logwork/${config.username}/jira-token`);
    } catch (err) {
      console.error(`Failed to retrieve token for ${config.username}:`, err);
      await updateConfigStatus(config, { status: 'paused_auth', lastRunAt: now.toISOString(), lastRunStatus: 'failed' });
      await sendEmail(
        config.email,
        `[Auto Logwork] Action required — ${config.projectName}`,
        buildReauthEmail(config)
      );
      continue;
    }

    // 2. Get period dates
    const { startDate, endDate } = getPeriod(config, now);

    // 3. Get missing dates from Jira
    let missingDates: string[];
    try {
      missingDates = await getMissingDates(config, token, startDate, endDate);
    } catch (err: any) {
      if (err.authError) {
        await updateConfigStatus(config, { status: 'paused_auth', lastRunAt: now.toISOString(), lastRunStatus: 'failed' });
        await sendEmail(
          config.email,
          `[Auto Logwork] Action required — ${config.projectName}`,
          buildReauthEmail(config)
        );
      } else {
        console.error(`Failed to get missing dates for ${config.configId}:`, err);
        await updateConfigStatus(config, { lastRunAt: now.toISOString(), lastRunStatus: 'failed' });
        await sendEmail(
          config.email,
          `[Auto Logwork] ${config.projectName} — run failed`,
          `<html><body><p>Auto logwork failed for <strong>${config.projectName}</strong>.</p><p>Error: ${String(err.message)}</p></body></html>`
        );
      }
      continue;
    }

    // 4. Nothing to log
    if (missingDates.length === 0) {
      await updateConfigStatus(config, { lastRunAt: now.toISOString(), lastRunStatus: 'nothing_to_log' });
      await sendEmail(
        config.email,
        `[Auto Logwork] ${config.projectName} — nothing to log`,
        `<html><body style="font-family:sans-serif"><h2>Auto Logwork — ${config.projectName}</h2><p>Period: <strong>${startDate}</strong> to <strong>${endDate}</strong></p><p>All worklogs are already submitted for this period.</p></body></html>`
      );
      continue;
    }

    // 5. Pre-fetch typeOfWork for all tickets
    const typeOfWorkMap = new Map<string, string | undefined>();
    for (const ticket of config.tickets) {
      const tow = await getTypeOfWork(ticket.issueKey, config.jiraInstance, token);
      typeOfWorkMap.set(ticket.issueKey, tow);
      await sleep(200);
    }

    // 6. Log work for each date × ticket
    const ticketResults: Array<{ issueKey: string; successCount: number; totalDates: number; hours: number }> = [];
    let anyFailure = false;

    for (const ticket of config.tickets) {
      let successCount = 0;
      const typeOfWork = typeOfWorkMap.get(ticket.issueKey);

      for (const date of missingDates) {
        const result = await logWork(ticket, date, config.username, config.jiraInstance, token, typeOfWork);
        if (result.success) {
          successCount++;
        } else {
          anyFailure = true;
          console.error(`Failed to log ${ticket.issueKey} on ${date}: ${result.error}`);
        }
        await sleep(REQUEST_DELAY_MS);
      }

      ticketResults.push({
        issueKey: ticket.issueKey,
        successCount,
        totalDates: missingDates.length,
        hours: ticket.hours,
      });
    }

    // 7. Update config and send email
    const lastRunStatus = anyFailure
      ? ticketResults.some((r) => r.successCount > 0)
        ? 'partial'
        : 'failed'
      : 'success';

    await updateConfigStatus(config, { lastRunAt: now.toISOString(), lastRunStatus });

    await sendEmail(
      config.email,
      `[Auto Logwork] ${config.projectName} — ${startDate} to ${endDate}`,
      buildSuccessEmail(config, startDate, endDate, missingDates, ticketResults)
    );

    console.log(`Completed config ${config.configId}: ${lastRunStatus}`);
  }

  console.log('Auto logwork executor finished');
};
