import express from 'express';
import cors from 'cors';
// Need to install helmet:
// npm install helmet @types/helmet
// import helmet from 'helmet';
import dotenv from 'dotenv';
import winston from 'winston';
import process from 'process';
import rateLimiterMiddleware from './middleware/rateLimiter';
import { browserManager } from './browserManager';
import { processWebsite } from './processLinks'; // Import the processWebsite middleware directly
import processWebsiteRouter from './routes/processWebsite'; // Import our new processWebsite router
import { RequestQueue } from './utils/requestQueue';
import metrics from './routes/metrics';
// Initialize environment variables
dotenv.config();
import { Permit } from 'permitio';

// Initialize Permit.io SDK (using hosted Cloud PDP by default)
const permit = new Permit({
  pdp: 'https://cloudpdp.api.permit.io',  // Explicitly use cloud PDP
  token: process.env.PERMIT_API_KEY,
  log: { level: 'debug' },         // uncomment to see SDK internals
  // throwOnError: true,            // optional: let SDK throw on PDP errors
});
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
app.use(cors());
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

// API key middleware
app.use((req, res, next) => {
  const apiKey = req.headers['x-api-key'] as string;
  // Accept the main SERVICE key plus PRO and FREE test keys
  const validKeys = [
    process.env.API_KEY,
    process.env.PRO_API_KEY,
    process.env.FREE_API_KEY
  ];
  // Skip API key check in development mode if configured
  if (process.env.NODE_ENV === 'development' && process.env.SKIP_API_KEY_CHECK === 'true') {
    return next();
  }
  
  if (!apiKey || !validKeys.includes(apiKey)) {
    return res.status(401).json({ success: false, error: 'Unauthorized - Invalid API key' });
  }
  
  next();
});

app.use(async (req, res, next) => {
  if (req.path === '/api/processLinks' && req.method === 'POST') {
    const apiKey = req.headers['x-api-key'] as string;
    
    // Determine user role based on API key type
    let role = 'free';
    if (apiKey === process.env.PRO_API_KEY) {
      role = 'pro';
    } else if (apiKey === process.env.API_KEY) {
      role = 'service';
    }

    // Minimal user info for cloud PDP
    const user = {
      key: apiKey,
      email: 'john@company.com'
    };

    try {
      // Sync user with Permit.io
      await permit.api.syncUser(user);
      
      // Check if user has permission to read website content
      const allowed = await permit.check(user, 'read', 'website');
      
      if (!allowed) {
        logger.warn(`Access denied for user ${user.key} - insufficient permissions`);
        return res.status(403).json({ 
          success: false, 
          error: 'Access denied - You need appropriate permissions to scrape websites' 
        });
      }

      // If we get here, user is authorized
      logger.info(`User ${user.key} authorized to process website`);
      
      // Continue with the rest of the request processing...
    } catch (err) {
      logger.error('Permit PDP connection error:', err);
      return res.status(500).json({ success: false, error: 'Authorization service unavailable' });
    }
  }
  next();
});
// Apply process website middleware directly instead of using a router
app.use(processWebsite);

// Apply our new processWebsite router
app.use(processWebsiteRouter);

// Health check endpoint
app.get('/health', async (req, res) => {
  const browserStatus = await browserManager.getBrowserStatus();
  const queueStatus = requestQueue.getStatus();
  
  const memoryUsage = process.memoryUsage();
  const uptime = process.uptime();
  
  res.json({
    status: 'ok',
    uptime,
    memoryUsage: {
      rss: Math.round(memoryUsage.rss / 1024 / 1024),
      heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      external: Math.round(memoryUsage.external / 1024 / 1024)
    },
    browser: browserStatus,
    queue: queueStatus
  });
});

app.use('/metrics', metrics);


// Start server
const server = app.listen(port, () => {
  logger.info(`Server started on port ${port}`);
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
