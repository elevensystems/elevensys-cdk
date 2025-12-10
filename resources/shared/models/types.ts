export interface Ticket {
  ticketId: string;
  timeSpend: string;
  description: string;
  typeOfWork: string;
  [key: string]: string; // For any additional properties
}

export type JiraInstance = 'jira3' | 'jira9' | 'jiradc';

export interface TimesheetRequest {
  username: string;
  dates: string;
  tickets: Ticket[];
  jiraInstance: JiraInstance;
  [key: string]: any;
}

// SQS Fan-Out Types
export interface TicketMessage {
  jobId: string;
  username: string;
  date: string;
  ticket: Ticket;
  token: string;
  jiraInstance: JiraInstance;
}

export interface JobStatus {
  jobId: string;
  total: number;
  processed: number;
  failed: number;
  status: 'in-progress' | 'completed' | 'failed';
  createdAt: string;
  updatedAt?: string;
  errors?: Array<{
    ticketId: string;
    date: string;
    error: string;
  }>;
}

export interface CreateJobRequest {
  username: string;
  dates: string;
  tickets: Ticket[];
  jiraInstance: JiraInstance;
}

export interface CreateJobResponse {
  jobId: string;
  total: number;
  message: string;
}
