export interface Ticket {
  ticketId: string;
  timeSpend: string;
  description: string;
  typeOfWork: string;
  [key: string]: string; // For any additional properties
}

export interface TimesheetRequest {
  username: string;
  dates: string;
  tickets: Ticket[];
  [key: string]: any;
}

// SQS Fan-Out Types
export interface TicketMessage {
  jobId: string;
  username: string;
  date: string;
  ticket: Ticket;
  token: string;
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
}

export interface CreateJobResponse {
  jobId: string;
  total: number;
  message: string;
}
