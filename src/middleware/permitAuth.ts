import { Request, Response, NextFunction } from 'express';
import { Permit } from 'permitio';
import winston from 'winston';
import dotenv from 'dotenv';

// Ensure environment variables are loaded
dotenv.config();

// Initialize logger
const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'permit-auth' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// Debug log environment variables
logger.debug('Environment variables in permitAuth:', {
  PERMIT_API_KEY_SET: !!process.env.PERMIT_API_KEY,
  PERMIT_API_KEY_LENGTH: process.env.PERMIT_API_KEY?.length,
  NODE_ENV: process.env.NODE_ENV
});

// Initialize Permit.io SDK
let permit: Permit;

function initializePermit() {
  if (!process.env.PERMIT_API_KEY) {
    throw new Error('PERMIT_API_KEY environment variable is required');
  }

  permit = new Permit({
    token: process.env.PERMIT_API_KEY,
    pdp: 'https://cloudpdp.api.permit.io'
  });

  logger.info('Permit.io SDK initialized');
  return permit;
}

interface PermitUser {
  key: string;
  email: string;
  attributes?: {
    tier: string;
    roles?: string[];
  };
}

export const permitAuth = async (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.headers['x-api-key'] as string;
  const url = req.body.url;
  const isAdvanced = req.body.advanced === true;

  if (!apiKey) {
    return res.status(401).json({ success: false, error: 'API key is required' });
  }

  try {
    // Initialize Permit if not already initialized
    if (!permit) {
      permit = initializePermit();
    }

    // Map API keys to user keys and tiers
    let userKey: string;
    let tier: string;
    
    switch (apiKey) {
      case process.env.ADMIN_API_KEY:
        userKey = '2025DEVChallenge_admin';
        tier = 'admin';
        break;
      case process.env.PRO_API_KEY:
        userKey = '2025DEVChallenge_user';
        tier = 'pro_user';
        break;
      case process.env.FREE_API_KEY:
        userKey = '2025DEVChallenge_user';
        tier = 'free_user';
        break;
      default:
        return res.status(401).json({ success: false, error: 'Invalid API key' });
    }

    const hostname = new URL(url).hostname;

    // Create user object with proper tier-based roles
    const user: PermitUser = {
      key: userKey,
      email: `${userKey}@scrapebase.xyz`,
      attributes: {
        tier,
        roles: [tier]  // Use the tier directly as role
      }
    };

    logger.debug('User object for permission check:', { 
      userKey,
      tier, 
      apiKey,
      roles: user.attributes?.roles,
      action: isAdvanced ? 'scrape_advanced' : 'scrape_basic',
      resourceType: 'website',
      resourceKey: hostname
    });
    
    // Sync user with Permit.io
    await permit.api.syncUser(user);

    // Create resource with proper key and attributes
    const resource = {
      type: 'website',
      key: hostname,
      attributes: {
        domain: hostname,
        is_premium: isAdvanced
      }
    };

    // Determine required action based on request parameters
    const action = isAdvanced ? 'scrape_advanced' : 'scrape_basic';

    logger.debug('Permission check details:', { 
      action, 
      resource,
      user: {
        key: user.key,
        tier: user.attributes?.tier,
        roles: user.attributes?.roles
      }
    });

    // Check permission with complete resource context
    const permissionCheck = await permit.check(user.key, action, resource.type, {
      tenant: 'default',
      resource: resource
    });

    logger.debug('Permission check result:', {
      allowed: permissionCheck,
      action,
      userKey: user.key,
      tier,
      roles: user.attributes?.roles
    });

    if (!permissionCheck) {
      logger.warn(`Access denied for user ${user.key} (${tier}) - insufficient permissions for ${action}`);
      return res.status(403).json({
        success: false,
        error: 'Access denied',
        details: `Your current plan (${tier}) does not allow ${action} operations`
      });
    }

    // Add user context to request for downstream use
    req.user = user;
    next();
  } catch (error: any) {
    logger.error('Permit.io authorization error:', error);
    return res.status(500).json({
      success: false,
      error: 'Authorization service error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Type augmentation for Express Request
declare global {
  namespace Express {
    interface Request {
      user?: PermitUser;
    }
  }
}