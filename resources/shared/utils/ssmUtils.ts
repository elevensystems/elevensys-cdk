import ssmService from '../services/ssmClient';
import { JiraInstance } from '../models/types';

export async function getTimesheetApiUrl(
  jiraInstance: JiraInstance
): Promise<string> {
  const parameterName = `/timesheet-core/${jiraInstance}`;
  const getTimesheetApiUrl = await ssmService.getParameterValue(parameterName);
  console.log(`Timesheet API URL for ${jiraInstance}: ${getTimesheetApiUrl}`);
  return getTimesheetApiUrl;
}
