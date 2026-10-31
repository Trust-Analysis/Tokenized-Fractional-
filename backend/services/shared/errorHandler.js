// Federated Error Handler
// Handles errors across federated services with partial data support

class FederatedErrorHandler {
  constructor() {
    this.errorCodes = {
      SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
      TIMEOUT: 'TIMEOUT',
      VALIDATION_ERROR: 'VALIDATION_ERROR',
      AUTHORIZATION_ERROR: 'AUTHORIZATION_ERROR',
      NOT_FOUND: 'NOT_FOUND',
      INTERNAL_ERROR: 'INTERNAL_ERROR',
      FEDERATION_ERROR: 'FEDERATION_ERROR',
      PARTIAL_DATA: 'PARTIAL_DATA'
    };
  }

  /**
   * Format error for GraphQL response
   */
  formatError(error, context = {}) {
    const { serviceName, operation, requestId } = context;
    
    // Log the error
    this.logError(error, { serviceName, operation, requestId });

    // Determine error code
    const code = this.determineErrorCode(error);

    // Build error response
    const formattedError = {
      message: error.message,
      code,
      ...(serviceName && { service: serviceName }),
      ...(operation && { operation }),
      ...(requestId && { requestId }),
      timestamp: new Date().toISOString()
    };

    // Add partial data indicator if applicable
    if (code === this.errorCodes.PARTIAL_DATA) {
      formattedError.partial = true;
      formattedError.availableServices = error.availableServices || [];
    }

    return formattedError;
  }

  /**
   * Determine error code based on error type
   */
  determineErrorCode(error) {
    if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
      return this.errorCodes.TIMEOUT;
    }
    
    if (error.message.includes('Unauthorized') || error.message.includes('Forbidden')) {
      return this.errorCodes.AUTHORIZATION_ERROR;
    }
    
    if (error.message.includes('not found') || error.message.includes('Not Found')) {
      return this.errorCodes.NOT_FOUND;
    }
    
    if (error.message.includes('validation') || error.message.includes('Invalid')) {
      return this.errorCodes.VALIDATION_ERROR;
    }
    
    if (error.message.includes('service') || error.message.includes('Service')) {
      return this.errorCodes.SERVICE_UNAVAILABLE;
    }
    
    if (error.message.includes('federation') || error.message.includes('Federation')) {
      return this.errorCodes.FEDERATION_ERROR;
    }
    
    return this.errorCodes.INTERNAL_ERROR;
  }

  /**
   * Log error with context
   */
  logError(error, context) {
    const logEntry = {
      error: {
        message: error.message,
        name: error.name,
        stack: process.env.NODE_ENV === 'development' ? error.stack undefined
      },
      context,
      timestamp: new Date().toISOString()
    };
    
    console.error('Federated Error:', JSON.stringify(logEntry, null, 2));
  }

  /**
   * Handle partial data scenario
   */
  handlePartialData(results, failedServices) {
    const successfulServices = Object.keys(results).filter(
      service => !failedServices.includes(service)
    );

    const error = new Error(
      `Partial data returned. Failed services: ${failedServices.join(', ')}`
    );
    error.code = this.errorCodes.PARTIAL_DATA;
    error.availableServices = successfulServices;
    error.failedServices = failedServices;

    return error;
  }

  /**
   * Create partial data response
   */
  createPartialResponse(results, failedServices) {
    const partialError = this.handlePartialData(results, failedServices);
    
    return {
      data: results,
      errors: [this.formatError(partialError)],
      partial: true
    };
  }

  /**
   * Aggregate errors from multiple services
   */
  aggregateErrors(errors) {
    const aggregated = {
      totalErrors: errors.length,
      errorsByService: {},
      errorsByCode: {}
    };

    errors.forEach(error => {
      // Group by service
      if (error.service) {
        if (!aggregated.errorsByService[error.service]) {
          aggregated.errorsByService[error.service] = [];
        }
        aggregated.errorsByService[error.service].push(error);
      }

      // Group by code
      if (error.code) {
        if (!aggregated.errorsByCode[error.code]) {
          aggregated.errorsByCode[error.code] = [];
        }
        aggregated.errorsByCode[error.code].push(error);
      }
    });

    return aggregated;
  }

  /**
   * Retry logic for failed service calls
   */
  async withRetry(fn, options = {}) {
    const {
      maxRetries = 3,
      delay = 1000,
      backoff = 2,
      retryableErrors = [this.errorCodes.TIMEOUT, this.errorCodes.SERVICE_UNAVAILABLE]
    } = options;

    let lastError;
    let currentDelay = delay;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        const errorCode = this.determineErrorCode(error);

        // Don't retry if error is not retryable or we've exhausted retries
        if (!retryableErrors.includes(errorCode) || attempt === maxRetries) {
          throw error;
        }

        console.warn(`Retry attempt ${attempt + 1}/${maxRetries} after ${currentDelay}ms`);
        await this.sleep(currentDelay);
        currentDelay *= backoff;
      }
    }

    throw lastError;
  }

  /**
   * Sleep utility for retry delays
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Circuit breaker pattern for service calls
   */
  createCircuitBreaker(options = {}) {
    const {
      failureThreshold = 5,
      resetTimeout = 60000,
      monitoringPeriod = 10000
    } = options;

    let failures = 0;
    let lastFailureTime = null;
    let state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN

    return {
      async execute(fn) {
        // Check if circuit is open
        if (state === 'OPEN') {
          const timeSinceLastFailure = Date.now() - lastFailureTime;
          if (timeSinceLastFailure < resetTimeout) {
            throw new Error('Circuit breaker is OPEN');
          } else {
            state = 'HALF_OPEN';
          }
        }

        try {
          const result = await fn();
          
          // Reset on success
          if (state === 'HALF_OPEN') {
            state = 'CLOSED';
            failures = 0;
          }
          
          return result;
        } catch (error) {
          failures++;
          lastFailureTime = Date.now();
          
          // Open circuit if threshold reached
          if (failures >= failureThreshold) {
            state = 'OPEN';
            console.error(`Circuit breaker OPEN after ${failures} failures`);
          }
          
          throw error;
        }
      },

      getState() {
        return state;
      },

      getFailures() {
        return failures;
      },

      reset() {
        state = 'CLOSED';
        failures = 0;
        lastFailureTime = null;
      }
    };
  }
}

// Create global error handler instance
const errorHandler = new FederatedErrorHandler();

export { FederatedErrorHandler, errorHandler };
