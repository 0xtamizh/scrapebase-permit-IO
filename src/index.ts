import express from 'express';
import cors from 'cors';
// Need to install helmet:
// npm install helmet @types/helmet
// import helmet from 'helmet';
import dotenv from 'dotenv';
import winston from 'winston';
import process from 'process';
import rateLimiterMiddleware from './middleware/rateLimiter';
import { permitAuth } from './middleware/permitAuth';
import { browserManager } from './browserManager';
import { processWebsite } from './processLinks'; // Import the processWebsite middleware directly
import processWebsiteRouter from './routes/processWebsite'; // Import our new processWebsite router
import { RequestQueue } from './utils/requestQueue';
import metrics from './routes/metrics';
// Initialize environment variables
dotenv.config();

// Create logger
const logger = winston.createLogger({
  level: 'debug', // Show ALL logs including debug
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'scrapebase-server' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp }) => {
          // Truncate long messages to prevent console flooding
          let displayMessage = message;
          if (typeof message === 'string' && message.length > 200) {
            displayMessage = message.substring(0, 200) + '... [truncated]';
          }
          return `${timestamp} ${level}: ${displayMessage}`;
        })
      )
    })
  ]
});

// Create and export request queue
export const requestQueue = new RequestQueue(
  parseInt(process.env.MAX_CONCURRENT_REQUESTS || '50', 10),
  parseInt(process.env.REQUEST_TIMEOUT || '60000', 10),
  parseInt(process.env.QUEUE_TIMEOUT || '120000', 10)
);

// Create Express app
const app = express();
const port = process.env.PORT || 8080;

// Apply middleware
app.use(cors({
  origin: ['http://127.0.0.1:5500', 'http://localhost:5500'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'x-api-key']
}));
// app.use(helmet());
app.use(express.json());

// Add middleware to prevent response content logging
app.use((req, res, next) => {
  // Capture the original res.send and res.json
  const originalSend = res.send;
  const originalJson = res.json;
  
  // Override send method
  res.send = function(body) {
    // More comprehensive check for HTML/CSS content
    const isHTMLorCSS = typeof body === 'string' && (
      body.includes('<html') || 
      body.includes('<body') || 
      body.includes('<style') || 
      body.includes('color:') || 
      body.includes('background-color:') ||
      body.includes('<onetrust') ||
      body.includes('#onetrust') ||
      body.includes('.ot-sdk-') ||
      body.includes('cookielaw.org') ||
      body.includes('OneTrust') ||
      body.includes('ot-floating-button') ||
      body.includes('cookie-consent') ||
      body.includes('cookie policy') ||
      body.includes('privacy policy')
    );
    
    // Only log non-HTML/CSS content and keep it brief
    if (!isHTMLorCSS) {
      if (typeof body === 'string' && body.length > 200) {
        logger.debug(`Response sent [size: ${body.length} bytes]`);
      } else {
        logger.debug(`Response sent: ${typeof body === 'object' ? 'Object' : body}`);
      }
    }
    return originalSend.call(this, body);
  };
  
  // Override json method
  res.json = function(body) {
    const bodyString = JSON.stringify(body);
    
    // Only log JSON size, not content
    logger.debug(`JSON response sent [size: ${bodyString.length} bytes]`);
    
    return originalJson.call(this, body);
  };
  
  next();
});

// Apply rate limiter
app.use(rateLimiterMiddleware);

// Protected routes with Permit.io authorization
app.post('/api/processLinks', permitAuth, processWebsite);

// Public routes
app.use('/metrics', metrics);
app.use('/process', processWebsiteRouter);

// Health check endpoint
app.get('/health', async (req, res) => {
  const browserStatus = await browserManager.getBrowserStatus();
  const queueStatus = requestQueue.getStatus();
  
  const memoryUsage = process.memoryUsage();
  const uptime = process.uptime();
  
  res.json({
    status: 'healthy',
    browser: browserStatus,
    queue: queueStatus,
    memory: {
      heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + 'MB',
      rss: Math.round(memoryUsage.rss / 1024 / 1024) + 'MB'
    },
    uptime: Math.round(uptime / 60) + ' minutes'
  });
});

// Start server
const server = app.listen(port, () => {
  logger.info(`Server is running on port ${port}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully');
  
  server.close(async () => {
    logger.info('HTTP server closed');
    
    try {
      await browserManager.shutdown();
      logger.info('Browser manager closed');
      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown:', err);
      process.exit(1);
    }
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received. Shutting down gracefully');
  
  server.close(async () => {
    logger.info('HTTP server closed');
    
    try {
      await browserManager.shutdown();
      logger.info('Browser manager closed');
      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown:', err);
      process.exit(1);
    }
  });
});
