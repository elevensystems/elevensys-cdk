export function getCurrentTime(): string {
  const now = new Date();
  return now.toISOString();
}

export function parseDates(datesString: string): string[] {
  return datesString.split(',').map((date: string) => date.trim());
}
