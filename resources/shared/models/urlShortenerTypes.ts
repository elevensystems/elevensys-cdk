/**
 * Interface for URL data structure in the URL Shortener system
 */
export interface UrlData {
  PK: string;
  SK: string;
  ShortCode: string;
  OriginalUrl: string;
  Clicks: number;
  LastAccessed?: number;
  CreatedAt: number;
  CreatedBy?: string;
  TTL?: number;
  EntityType: string;
}
