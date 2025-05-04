import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';

// Create tier-based rate limiters with separate stores
const basicLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 5, // 5 requests per minute
    message: {
        success: false,
        message: "Rate limit exceeded. Basic users are limited to 5 requests per minute.",
        retryAfter: 60
    },
    keyGenerator: (req: Request): string => {
        const apiKey = req.headers['x-api-key'];
        return (typeof apiKey === 'string' ? apiKey : req.ip) || 'default';
    },
    skip: (req: Request) => {
        const apiKey = req.headers['x-api-key'] as string;
        // Only admin and pro users skip the basic limiter
        return apiKey === process.env.ADMIN_API_KEY || apiKey === process.env.PRO_API_KEY;
    }
});

const proLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 requests per minute
    message: {
        success: false,
        message: "Rate limit exceeded. Pro users are limited to 10 requests per minute.",
        retryAfter: 60
    },
    keyGenerator: (req: Request): string => {
        const apiKey = req.headers['x-api-key'];
        return (typeof apiKey === 'string' ? apiKey : req.ip) || 'default';
    },
    skip: (req: Request) => {
        const apiKey = req.headers['x-api-key'] as string;
        // Only admin users skip the pro limiter
        return apiKey === process.env.ADMIN_API_KEY;
    }
});

// Middleware to apply appropriate rate limiter
export default function rateLimiterMiddleware(req: Request, res: Response, next: NextFunction) {
    const apiKey = req.headers['x-api-key'] as string;
    
    if (apiKey === process.env.ADMIN_API_KEY) {
        // Admin users bypass rate limiting
        next();
    } else if (apiKey === process.env.PRO_API_KEY) {
        // Pro users get higher limit
        proLimiter(req, res, next);
    } else {
        // Basic users get lower limit
        basicLimiter(req, res, next);
    }
} 