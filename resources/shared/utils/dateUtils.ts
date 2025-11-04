export function getCurrentTime(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

export function parseDates(datesString: string): string[] {
  return datesString.split(',').map((date: string) => date.trim());
}
