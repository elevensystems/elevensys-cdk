import ssmService from '../services/ssmClient';

export async function getJiraApiUrl(): Promise<string> {
  const jiraApiUrl = await ssmService.getParameterValue(
    '/jira-timesheet/api-url'
  );
  console.log(`Jira API URL: ${jiraApiUrl}`);
  return jiraApiUrl;
}
