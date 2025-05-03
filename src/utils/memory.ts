import { JSDOM } from 'jsdom';
import winston from 'winston';
import os from 'os';

// Keep track of memory usage over time
const memoryHistory: number[] = [];
const MEMORY_HISTORY_SIZE = 10;
const MEMORY_THRESHOLD_PCT = 0.7; // 70% of max memory

const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'scrapebase-memory' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

/**
 * Safely dispose of a JSDOM instance to prevent memory leaks
 */
export function disposeDom(dom: JSDOM | null): void {
  if (!dom) return;
  
  try {
    // Close all resources in the window
    const win = dom.window;
    if (win) {
      // Stop any running timers
      const keys = Object.keys(win);
      keys.forEach(key => {
        // Clear any timeout or interval using their numeric handle
        if (!isNaN(Number(key))) {
          win.clearTimeout(Number(key));
          win.clearInterval(Number(key));
        }
      });
      
      // Cleanup any event listeners
      if (win.document) {
        win.document.querySelectorAll('*').forEach(element => {
          element.replaceWith(element.cloneNode(true));
        });
      }
      
      // Close the window
      win.close();
    }
  } catch (error) {
    logger.warn('Error disposing DOM', { error });
  }
  
  // Force null references to help GC
  Object.keys(dom).forEach(key => {
    // @ts-ignore
    dom[key] = null;
  });
}

/**
 * Check if memory usage is too high
 */
export function isMemoryPressureHigh(): boolean {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedPct = (totalMem - freeMem) / totalMem;
  
  memoryHistory.push(usedPct);
  
  // Keep only the most recent entries
  if (memoryHistory.length > MEMORY_HISTORY_SIZE) {
    memoryHistory.shift();
  }
  
  // Calculate average memory usage
  const avgMemUsage = memoryHistory.reduce((sum, val) => sum + val, 0) / memoryHistory.length;
  
  // Check if current memory usage is above threshold
  return avgMemUsage > MEMORY_THRESHOLD_PCT;
}

/**
 * Get current memory usage information 
 */
export function getMemoryInfo(): { total: number; free: number; used: number; rss: number } {
  const memInfo = process.memoryUsage();
  return {
    total: os.totalmem(),
    free: os.freemem(),
    used: os.totalmem() - os.freemem(),
    rss: memInfo.rss
  };
}

/**
 * Request garbage collection if available
 */
export function requestGarbageCollection(): void {
  if (global.gc) {
    try {
      global.gc();
      logger.debug('Garbage collection requested');
    } catch (error) {
      logger.warn('Error during garbage collection', { error });
    }
  }
}

/**
 * Clean up resources after a request
 */
export function cleanupResources(requestId: string): void {
  // Check if memory usage is actually high enough to warrant aggressive cleanup
  const memBefore = getMemoryInfo();
  const memPressureHigh = isMemoryPressureHigh();
  const isSubRequest = requestId.includes('-sub-');
  
  // For subpage requests, use a lighter cleanup with no delay
  if (isSubRequest) {
    // Skip aggressive cleanup for subpages unless memory pressure is very high
    if (global.gc && memPressureHigh) {
      global.gc();
    }
    return;
  }
  
  // For main requests, use a shorter timeout (was 500ms)
  setTimeout(() => {
    // Free any large object references first
    const largeObjects: any[] = [];
    while (largeObjects.length) {
      largeObjects.pop() && void 0;
    }
    
    // Only clear module caches if memory pressure is really high
    if (memPressureHigh && memBefore.rss > 500 * 1024 * 1024) { // Lower from 1.5GB to 800MB
      clearRequireCache();
    }
    
    // Request garbage collection
    requestGarbageCollection();
    
    // Only do second GC if memory is critically high
    if (memPressureHigh && memBefore.rss > 1 * 1024 * 1024 * 1024) { // Lower from 2GB to 1.2GB
      // Shorter delay for second GC
      setTimeout(() => {
        requestGarbageCollection();
        logger.debug(`[${requestId}] Second garbage collection performed due to critical memory pressure`);
      }, 300);
    }
    
    // Skip memory freed calculation to save time
    logger.debug(`[${requestId}] Memory cleanup performed`);
  }, 100); // Reduced from 500ms to 100ms
}

/**
 * Clear Node.js require cache for non-essential modules
 * This helps free memory when under pressure
 */
function clearRequireCache(): void {
  try {
    // Get list of cached modules
    const cachedModules = Object.keys(require.cache);
    
    // Skip core modules and essential dependencies
    const essentialModules = ['express', 'http', 'fs', 'path', 'events', 'os', 'util', 'process'];
    
    // Clear cache for non-essential modules
    cachedModules.forEach(modulePath => {
      const isEssential = essentialModules.some(mod => modulePath.includes(`/node_modules/${mod}/`));
      
      // Skip essential modules
      if (!isEssential && !modulePath.includes('node_modules/')) {
        delete require.cache[modulePath];
      }
    });
    
    logger.debug(`Cleared require cache for non-essential modules`);
  } catch (error) {
    logger.warn('Error clearing require cache:', error);
  }
} 