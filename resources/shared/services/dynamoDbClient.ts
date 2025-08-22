import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  UpdateCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';

/**
 * Class for interacting with DynamoDB
 */
export class DynamoDBService {
  private client: DynamoDBClient;
  private documentClient: DynamoDBDocumentClient;

  /**
   * Creates a new DynamoDB service instance
   * @param options Optional configuration for the DynamoDB client
   */
  constructor(options = {}) {
    this.client = new DynamoDBClient(options);
    this.documentClient = DynamoDBDocumentClient.from(this.client, {
      marshallOptions: {
        removeUndefinedValues: false,
      },
    });
  }

  /**
   * Retrieves all items from the specified DynamoDB table
   * @param tableName The name of the DynamoDB table
   * @param filterParams Additional scan parameters
   * @returns All items from the table
   */
  async scanItems<T = Record<string, any>>(
    tableName: string,
    filterParams = {}
  ): Promise<T[]> {
    try {
      const params = {
        TableName: tableName,
        ...filterParams,
      };

      const { Items } = await this.documentClient.send(new ScanCommand(params));
      return (Items as T[]) || [];
    } catch (error) {
      console.error(`Error scanning table ${tableName}:`, error);
      throw error;
    }
  }

  /**
   * Gets a single item from a DynamoDB table by its key
   * @param tableName The name of the DynamoDB table
   * @param key The primary key of the item (e.g., { id: '123' })
   * @returns The item if found, undefined otherwise
   */
  async getItem<T = Record<string, any>>(
    tableName: string,
    key: Record<string, any>
  ): Promise<T | undefined> {
    try {
      const params = {
        TableName: tableName,
        Key: key,
      };

      const { Item } = await this.documentClient.send(new GetCommand(params));
      return Item as T | undefined;
    } catch (error) {
      console.error(`Error getting item from ${tableName}:`, error);
      throw error;
    }
  }

  /**
   * Puts an item into a DynamoDB table
   * @param tableName The name of the DynamoDB table
   * @param item The item to put into the table
   * @returns The result of the put operation
   */
  async putItem(tableName: string, item: Record<string, any>): Promise<any> {
    try {
      const params = {
        TableName: tableName,
        Item: item,
      };

      return await this.documentClient.send(new PutCommand(params));
    } catch (error) {
      console.error(`Error putting item into ${tableName}:`, error);
      throw error;
    }
  }

  /**
   * Deletes an item from a DynamoDB table
   * @param tableName The name of the DynamoDB table
   * @param key The primary key of the item to delete
   * @returns The result of the delete operation
   */
  async deleteItem(tableName: string, key: Record<string, any>): Promise<any> {
    try {
      const params = {
        TableName: tableName,
        Key: key,
      };

      return await this.documentClient.send(new DeleteCommand(params));
    } catch (error) {
      console.error(`Error deleting item from ${tableName}:`, error);
      throw error;
    }
  }

  /**
   * Queries items from a DynamoDB table
   * @param tableName The name of the DynamoDB table
   * @param queryParams The query parameters
   * @returns The queried items
   */
  async queryItems<T = Record<string, any>>(
    tableName: string,
    queryParams: Record<string, any>
  ): Promise<T[]> {
    try {
      const params = {
        TableName: tableName,
        ...queryParams,
      };

      const { Items } = await this.documentClient.send(
        new QueryCommand(params)
      );
      return (Items as T[]) || [];
    } catch (error) {
      console.error(`Error querying ${tableName}:`, error);
      throw error;
    }
  }
}

// Create a default instance for ease of use
const dynamoDBService = new DynamoDBService();

// Export the default instance
export default dynamoDBService;
