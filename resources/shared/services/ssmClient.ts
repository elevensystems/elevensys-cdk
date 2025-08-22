import {
  SSMClient,
  GetParameterCommand,
  GetParametersCommand,
  PutParameterCommand,
  DeleteParameterCommand,
} from '@aws-sdk/client-ssm';

/**
 * Service class for interacting with AWS Systems Manager Parameter Store
 */
export class SSMService {
  private client: SSMClient;

  /**
   * Creates a new SSM service instance
   * @param options Optional configuration for the SSM client
   */
  constructor(options = {}) {
    this.client = new SSMClient(options);
  }

  /**
   * Retrieves a parameter value from SSM Parameter Store
   * @param parameterName The name of the parameter to retrieve
   * @param withDecryption Whether to decrypt the parameter (default: true)
   * @returns The parameter value as a string
   */
  async getParameterValue(
    parameterName: string,
    withDecryption = true
  ): Promise<string> {
    try {
      const command = new GetParameterCommand({
        Name: parameterName,
        WithDecryption: withDecryption,
      });

      const response = await this.client.send(command);
      if (!response.Parameter?.Value) {
        throw new Error(`Parameter ${parameterName} not found`);
      }
      return response.Parameter.Value;
    } catch (error) {
      console.error(`Error retrieving parameter ${parameterName}:`, error);
      throw error;
    }
  }

  /**
   * Retrieves multiple parameter values from SSM Parameter Store
   * @param parameterNames Array of parameter names to retrieve
   * @param withDecryption Whether to decrypt the parameters (default: true)
   * @returns Map of parameter names to their values
   */
  async getParameterValues(
    parameterNames: string[],
    withDecryption = true
  ): Promise<Map<string, string>> {
    try {
      const command = new GetParametersCommand({
        Names: parameterNames,
        WithDecryption: withDecryption,
      });

      const response = await this.client.send(command);
      const parameterMap = new Map<string, string>();

      response.Parameters?.forEach((param) => {
        if (param.Name && param.Value) {
          parameterMap.set(param.Name, param.Value);
        }
      });

      if (response.InvalidParameters && response.InvalidParameters.length > 0) {
        console.warn('Invalid parameters:', response.InvalidParameters);
      }

      return parameterMap;
    } catch (error) {
      console.error(`Error retrieving multiple parameters:`, error);
      throw error;
    }
  }

  /**
   * Puts a parameter into SSM Parameter Store
   * @param name The name of the parameter
   * @param value The value of the parameter
   * @param type The type of the parameter (String, StringList, or SecureString)
   * @param overwrite Whether to overwrite existing parameter (default: true)
   * @returns The response from the SSM service
   */
  async putParameter(
    name: string,
    value: string,
    type: 'String' | 'StringList' | 'SecureString',
    overwrite = true
  ): Promise<any> {
    try {
      const command = new PutParameterCommand({
        Name: name,
        Value: value,
        Type: type,
        Overwrite: overwrite,
      });

      return await this.client.send(command);
    } catch (error) {
      console.error(`Error putting parameter ${name}:`, error);
      throw error;
    }
  }

  /**
   * Deletes a parameter from SSM Parameter Store
   * @param name The name of the parameter to delete
   * @returns The response from the SSM service
   */
  async deleteParameter(name: string): Promise<any> {
    try {
      const command = new DeleteParameterCommand({
        Name: name,
      });

      return await this.client.send(command);
    } catch (error) {
      console.error(`Error deleting parameter ${name}:`, error);
      throw error;
    }
  }
}

// Create a default instance for ease of use
const ssmService = new SSMService();

// Export the default instance
export default ssmService;
