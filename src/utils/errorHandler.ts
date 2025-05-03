import { Response } from 'express';
import winston from 'winston';

const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'scrapebase-errors' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp }) => {
          // Truncate long messages to prevent console flooding
          let displayMessage = message;
          if (typeof message === 'string' && message.length > 500) {
            displayMessage = message.substring(0, 500) + '... [truncated]';
          }
          return `${timestamp} ${level}: ${displayMessage}`;
        })
      )
    })
  ]
});

/**
 * Standard error response structure
 */
export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
  };
  requestId: string;
  timestamp: number;
}

/**
 * Error codes for consistent API responses
 */
export enum ErrorCode {
  MISSING_PARAM = 'MISSING_PARAM',
  TIMEOUT = 'TIMEOUT',
  SCRAPING_ERROR = 'SCRAPING_ERROR',
  INVALID_URL = 'INVALID_URL',
  SERVER_ERROR = 'SERVER_ERROR',
  RATE_LIMIT = 'RATE_LIMIT',
  QUEUE_TIMEOUT = 'QUEUE_TIMEOUT',
  UNAUTHORIZED = 'UNAUTHORIZED',
  BROWSER_ERROR = 'BROWSER_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR'
}

/**
 * HTTP status code mapping
 */
const statusCodeMap: Record<ErrorCode, number> = {
  [ErrorCode.MISSING_PARAM]: 400,
  [ErrorCode.TIMEOUT]: 408,
  [ErrorCode.SCRAPING_ERROR]: 422,
  [ErrorCode.INVALID_URL]: 400,
  [ErrorCode.SERVER_ERROR]: 500,
  [ErrorCode.RATE_LIMIT]: 429,
  [ErrorCode.QUEUE_TIMEOUT]: 429,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.BROWSER_ERROR]: 500,
  [ErrorCode.VALIDATION_ERROR]: 400
};

/**
 * Filter content to prevent logging HTML/CSS content
 */
function filterLoggableContent(content: any): any {
  if (typeof content !== 'string') {
    return content;
  }
  
  // Check for OneTrust specific content
  if (content.includes('#onetrust-') || 
      content.includes('.ot-sdk-') || 
      content.includes('cookielaw.org') ||
      content.includes('OneTrust') ||
      content.includes('ot-floating-button')) {
    return `[OneTrust content, ${content.length} bytes]`;
  }
  
  // Check if content is HTML/CSS
  if (content.includes('<html') || 
      content.includes('<body') || 
      content.includes('<style') || 
      content.includes('#onetrust') ||
      content.includes('color:') || 
      content.includes('background-color:')) {
    return `[HTML/CSS content, ${content.length} bytes]`;
  }
  
  // Already getting truncated by the logger format
  return content;
}

/**
 * Send a standardized error response
 */
export function sendErrorResponse(
  res: Response,
  code: ErrorCode,
  message: string,
  requestId: string,
  details?: any,
  overrideStatus?: number
): void {
  const statusCode = overrideStatus || statusCodeMap[code] || 500;
  
  // Filter details if it contains HTML/CSS
  let filteredDetails = details;
  if (details && typeof details === 'object') {
    filteredDetails = { ...details };
    if (filteredDetails.originalError) {
      filteredDetails.originalError = filterLoggableContent(filteredDetails.originalError);
    }
  }
  
  const errorResponse: ErrorResponse = {
    success: false,
    error: {
      code,
      message,
      ...(filteredDetails ? { details: filteredDetails } : {})
    },
    requestId,
    timestamp: Date.now()
  };
  
  // Log the error
  const filteredMessage = filterLoggableContent(message);
  if (statusCode >= 500) {
    logger.error(`[${requestId}] ${code}: ${filteredMessage}`, { details: filteredDetails });
  } else {
    logger.warn(`[${requestId}] ${code}: ${filteredMessage}`, { details: filteredDetails });
  }
  
  res.status(statusCode).json(errorResponse);
}

/**
 * Parse error and determine the appropriate error code
 */
export function parseError(error: unknown): { code: ErrorCode, message: string, details?: any } {
  if (error instanceof Error) {
    const errorMessage = error.message.toLowerCase();
    
    // Detect timeout errors
    if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
      return { code: ErrorCode.TIMEOUT, message: 'Request timed out' };
    }
    
    // Detect network errors
    if (errorMessage.includes('net::') || errorMessage.includes('network') || errorMessage.includes('connection')) {
      return { 
        code: ErrorCode.SCRAPING_ERROR, 
        message: 'Network error while scraping the website',
        details: { originalError: error.message } 
      };
    }
    
    // Detect browser errors
    if (
      errorMessage.includes('browser') || 
      errorMessage.includes('context') || 
      errorMessage.includes('page') ||
      errorMessage.includes('execution context destroyed')
    ) {
      return { 
        code: ErrorCode.BROWSER_ERROR, 
        message: 'Browser error occurred',
        details: { originalError: error.message } 
      };
    }
    
    // Detect validation errors
    if (errorMessage.includes('invalid') || errorMessage.includes('required')) {
      return { 
        code: ErrorCode.VALIDATION_ERROR, 
        message: error.message,
      };
    }
    
    // Fallback for general errors
    return { 
      code: ErrorCode.SERVER_ERROR, 
      message: 'An unexpected error occurred',
      details: { originalError: error.message, stack: error.stack } 
    };
  }
  
  // Handle non-Error objects
  return { 
    code: ErrorCode.SERVER_ERROR, 
    message: 'An unexpected error occurred',
    details: { originalError: String(error) } 
  };
} 