export interface Ticket {
  ticketId: string;
  timeSpend: string;
  description: string;
  typeOfWork: string;
  [key: string]: string; // For any additional properties
}

export interface TimesheetRequest {
  dates: string;
  [key: string]: any;
}
