import ssmService from '../services/ssmClient';

export async function getTimesheetApiUrl(): Promise<string> {
  const getTimesheetApiUrl =
    await ssmService.getParameterValue('timesheet-core');
  console.log(`Timesheet API URL: ${getTimesheetApiUrl}`);
  return getTimesheetApiUrl;
}
