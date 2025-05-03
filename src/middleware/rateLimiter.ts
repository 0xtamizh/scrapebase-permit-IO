import { Request, Response, NextFunction } from 'express';

// Define rate limiter entry interface
interface RateLimiterEntry {
  count: number;
  resetTime: number;
}

// Simple in-memory rate limiter
class RateLimiter {
  private requests: Map<string, RateLimiterEntry> = new Map();
  private readonly windowMs: number;
  private readonly maxRequests: number;
  
  // Global rate limiter properties
  private globalRequests: number = 0;
  private globalResetTime: number = Date.now();
  private readonly globalWindowMs: number = 1000; // 1 second window
  private readonly globalMaxRequests: number = 50; // Max 50 requests per second globally
  private readonly burstProtectionEnabled: boolean = true;
  
  // Add getter for maxRequests
  public get limit(): number {
    return this.maxRequests;
  }
  
  constructor(windowMs = 60000, maxRequests = 10) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    
    // Clean up expired entries every minute
    setInterval(() => this.cleanup(), 60000);
    
    // Reset global counter every window
    setInterval(() => {
      this.globalRequests = 0;
      this.globalResetTime = Date.now() + this.globalWindowMs;
    }, this.globalWindowMs);
  }
  
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.requests.entries()) {
      if (now > entry.resetTime) {
        this.requests.delete(key);
      }
    }
  }
  
  // Check if a request should be allowed (both per-IP and global limits)
  public isAllowed(ip: string): boolean {
    const now = Date.now();
    
    // First check global rate limit
    if (this.burstProtectionEnabled) {
      if (now > this.globalResetTime) {
        this.globalRequests = 1;
        this.globalResetTime = now + this.globalWindowMs;
      } else {
        this.globalRequests++;
        if (this.globalRequests > this.globalMaxRequests) {
          console.warn(`Global rate limit exceeded: ${this.globalRequests}/${this.globalMaxRequests} requests`);
          return false;
        }
      }
    }
    
    // Then check per-IP limit
    // Get or create client entry
    if (!this.requests.has(ip)) {
      this.requests.set(ip, {
        count: 1,
        resetTime: now + this.windowMs
      });
      return true;
    }
    
    const entry = this.requests.get(ip)!;
    
    // Reset counter if window has passed
    if (now > entry.resetTime) {
      entry.count = 1;
      entry.resetTime = now + this.windowMs;
      return true;
    }
    
    // Increment counter and check limit
    entry.count++;
    const allowed = entry.count <= this.maxRequests;
    
    if (!allowed) {
      console.warn(`IP rate limit exceeded for ${ip}: ${entry.count}/${this.maxRequests} requests`);
    }
    
    return allowed;
  }
  
  // Get remaining requests for this IP
  public getRemainingRequests(ip: string): number {
    if (!this.requests.has(ip)) {
      return this.maxRequests;
    }
    
    const entry = this.requests.get(ip)!;
    return Math.max(0, this.maxRequests - entry.count);
  }
  
  // Get time until reset for this IP (in seconds)
  public getResetTime(ip: string): number {
    if (!this.requests.has(ip)) {
      return 0;
    }
    
    const entry = this.requests.get(ip)!;
    return Math.max(0, Math.ceil((entry.resetTime - Date.now()) / 1000));
  }
  
  // Get global rate limit info
  public getGlobalRateLimitInfo(): { current: number, max: number, remaining: number, resetIn: number } {
    return {
      current: this.globalRequests,
      max: this.globalMaxRequests,
      remaining: Math.max(0, this.globalMaxRequests - this.globalRequests),
      resetIn: Math.max(0, Math.ceil((this.globalResetTime - Date.now()) / 1000))
    };
  }
}

// Create a global rate limiter instance
const rateLimiter = new RateLimiter();

// Express middleware
export function rateLimiterMiddleware(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  
  if (rateLimiter.isAllowed(ip)) {
    // Set headers with rate limit info
    res.setHeader('X-RateLimit-Limit', rateLimiter.limit.toString());
    res.setHeader('X-RateLimit-Remaining', rateLimiter.getRemainingRequests(ip).toString());
    res.setHeader('X-RateLimit-Reset', rateLimiter.getResetTime(ip).toString());
    
    // Also set global rate limit headers
    const globalInfo = rateLimiter.getGlobalRateLimitInfo();
    res.setHeader('X-Global-RateLimit-Limit', globalInfo.max.toString());
    res.setHeader('X-Global-RateLimit-Remaining', globalInfo.remaining.toString());
    res.setHeader('X-Global-RateLimit-Reset', globalInfo.resetIn.toString());
    
    next();
  } else {
    // Set headers for rate limit exceeded
    res.setHeader('X-RateLimit-Limit', rateLimiter.limit.toString());
    res.setHeader('X-RateLimit-Remaining', '0');
    res.setHeader('X-RateLimit-Reset', rateLimiter.getResetTime(ip).toString());
    
    // Add a short random delay to prevent timing attacks
    setTimeout(() => {
      res.status(429).json({
        success: false,
        message: 'Too many requests, please try again later.',
        retryAfter: rateLimiter.getResetTime(ip)
      });
    }, Math.floor(Math.random() * 500));
  }
}

export default rateLimiterMiddleware; 