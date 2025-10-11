# URL Shortener Lambda

A serverless URL shortening service built with AWS Lambda, API Gateway, and DynamoDB.

## Features

- ✨ Create shortened URLs with automatic short code generation
- 🔄 Redirect to original URLs with click tracking
- 📊 Get detailed statistics for each shortened URL
- 📋 List all URLs with pagination support
- 🗑️ Delete shortened URLs
- ⏰ Automatic expiration after 30 days (TTL)
- 🏥 Health check endpoint

## API Endpoints

### 1. Create Shortened URL

**POST** `/api/shorten`

Create a new shortened URL.

**Request Body:**

```json
{
  "originalUrl": "https://example.com/very/long/url",
  "createdBy": "user123" // Optional
}
```

**Response (201 Created):**

```json
{
  "message": "URL shortened successfully",
  "data": {
    "shortCode": "abc123",
    "shortUrl": "https://short.url/abc123",
    "originalUrl": "https://example.com/very/long/url",
    "createdAt": "2025-10-11T12:00:00.000Z",
    "expiresAt": "2025-11-10T12:00:00.000Z"
  }
}
```

### 2. Redirect to Original URL

**GET** `/:shortCode`

Redirects to the original URL and increments the click counter.

**Response:** 301 Redirect to original URL

### 3. Get URL Statistics

**GET** `/api/stats/:shortCode`

Get detailed statistics for a shortened URL.

**Response (200 OK):**

```json
{
  "message": "URL statistics retrieved successfully",
  "data": {
    "shortCode": "abc123",
    "originalUrl": "https://example.com/very/long/url",
    "clicks": 42,
    "createdAt": "2025-10-11T12:00:00.000Z",
    "lastAccessed": "2025-10-11T14:30:00.000Z",
    "expiresAt": "2025-11-10T12:00:00.000Z",
    "createdBy": "user123"
  }
}
```

### 4. List All URLs

**GET** `/api/urls`

List all shortened URLs with pagination.

**Query Parameters:**

- `limit` (optional): Number of results per page (default: 20)
- `lastKey` (optional): JSON string of the last evaluated key for pagination

**Response (200 OK):**

```json
{
  "message": "URLs retrieved successfully",
  "data": {
    "urls": [
      {
        "shortCode": "abc123",
        "shortUrl": "https://short.url/abc123",
        "originalUrl": "https://example.com/very/long/url",
        "clicks": 42,
        "createdAt": "2025-10-11T12:00:00.000Z",
        "lastAccessed": "2025-10-11T14:30:00.000Z",
        "expiresAt": "2025-11-10T12:00:00.000Z"
      }
    ],
    "count": 1,
    "lastEvaluatedKey": { "PK": "URL#abc123", "SK": "METADATA" }
  }
}
```

### 5. Delete Shortened URL

**DELETE** `/api/url/:shortCode`

Delete a shortened URL.

**Response (200 OK):**

```json
{
  "message": "URL deleted successfully",
  "data": {
    "shortCode": "abc123",
    "deleted": true
  }
}
```

### 6. Health Check

**GET** `/health`

Check if the service is running.

**Response (200 OK):**

```json
{
  "message": "Service is healthy",
  "data": {
    "status": "ok",
    "timestamp": "2025-10-11T12:00:00.000Z"
  }
}
```

## DynamoDB Schema

### Table Structure

- **Table Name**: Configured via `URL_SHORTENER_TABLE_NAME` environment variable
- **Partition Key**: `PK` (String) - Format: `URL#{shortCode}`
- **Sort Key**: `SK` (String) - Value: `METADATA`
- **Billing Mode**: PAY_PER_REQUEST
- **TTL Attribute**: `TTL` (30 days)

### Item Structure

```typescript
{
  PK: 'URL#abc123',                    // Partition Key
  SK: 'METADATA',                      // Sort Key

  ShortCode: 'abc123',                 // 6-character random code
  OriginalUrl: 'https://example.com/long/url',

  Clicks: 42,                          // Click counter
  LastAccessed: 1696723200000,        // Unix timestamp (ms)
  CreatedAt: 1696636800000,           // Unix timestamp (ms)

  CreatedBy: 'user123',               // Optional user tracking

  TTL: 1699228800,                    // Unix timestamp (seconds) for auto-deletion

  EntityType: 'URL'                   // Entity type marker
}
```

## Environment Variables

- `URL_SHORTENER_TABLE_NAME`: DynamoDB table name (required)
- `BASE_URL`: Base URL for short links (default: 'https://short.url')
- `NODE_OPTIONS`: Node.js options (set to `--enable-source-maps` for debugging)

## Configuration

### Short Code Settings

- **Length**: 6 characters
- **Character Set**: A-Z, a-z, 0-9 (62 possible characters)
- **Total Combinations**: ~56.8 billion unique codes

### TTL Settings

- **Duration**: 30 days from creation
- **Auto-deletion**: Handled by DynamoDB TTL feature

## Error Handling

All errors follow a standard format:

```json
{
  "message": "Error message",
  "errors": [
    {
      "code": "ERROR_CODE",
      "detail": "Detailed error description"
    }
  ]
}
```

### Common Error Codes

- `MISSING_FIELD`: Required field is missing
- `INVALID_URL`: URL format is invalid
- `MISSING_PARAM`: Required parameter is missing

### HTTP Status Codes

- `200`: Success
- `201`: Created
- `301`: Permanent Redirect
- `400`: Bad Request
- `404`: Not Found
- `500`: Internal Server Error

## Usage Examples

### cURL Examples

#### Create a shortened URL

```bash
curl -X POST https://api.example.com/api/shorten \
  -H "Content-Type: application/json" \
  -d '{
    "originalUrl": "https://example.com/very/long/url",
    "createdBy": "user123"
  }'
```

#### Get statistics

```bash
curl https://api.example.com/api/stats/abc123
```

#### List URLs

```bash
curl "https://api.example.com/api/urls?limit=10"
```

#### Delete URL

```bash
curl -X DELETE https://api.example.com/api/url/abc123
```

## Development

### Prerequisites

- Node.js 18+
- AWS CDK
- AWS Account with appropriate permissions

### Local Testing

The Lambda function can be tested locally using the AWS SAM CLI or by invoking it directly with test events.

### Deployment

This Lambda is deployed as part of the `UrlShortenerStack` CDK stack.

```bash
npm run cdk deploy UrlShortenerStack
```

## Performance Considerations

- **Cold Start**: Optimized with ARM64 architecture and minimal dependencies
- **Memory**: 128 MB (adjustable based on load)
- **Timeout**: 15 seconds
- **Click Tracking**: Asynchronous to avoid blocking redirects
- **Database**: DynamoDB provides single-digit millisecond latency

## Security

- CORS enabled for all origins (configure based on your needs)
- URL validation to prevent invalid URLs
- Conditional writes to prevent race conditions
- TTL-based automatic cleanup
