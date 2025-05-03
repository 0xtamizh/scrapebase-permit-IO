import { Router, Request, Response } from 'express';
import { browserManager } from '../browserManager';
import { requestQueue } from '../utils/requestQueue';
import { getMemoryInfo, isMemoryPressureHigh } from '../utils/memory';
import os from 'os';

const router = Router();

// Get process start time
const startTime = Date.now();

// CPU calculation helper
let lastCpuUsage = process.cpuUsage();
let lastCpuTime = Date.now();

// Track memory usage over time for trend analysis
const memoryHistory: number[] = [];
const MEMORY_HISTORY_SIZE = 10;

// Define types for context metrics
interface ContextMetric {
  id: number;
  pagesCount: number;
  urls?: string[];
}

// Add missing RequestQueue interface methods if they don't exist
interface EnhancedRequestQueue {
  getActiveCount(): number;
  getPendingCount(): number;
  getCompletedCount(): number;
  getAverageProcessingTime(): number;
}

// Add helper to check and provide default values for queue metrics
function getQueueMetrics(queue: any): { active: number, pending: number, completed: number, avgProcessingTime: string } {
  // Default implementation if methods don't exist
  const hasMetrics = typeof queue.getActiveCount === 'function';
  
  return {
    active: hasMetrics ? queue.getActiveCount() : 0,
    pending: hasMetrics ? queue.getPendingCount() : 0,
    completed: hasMetrics ? queue.getCompletedCount() : 0,
    avgProcessingTime: hasMetrics ? queue.getAverageProcessingTime().toFixed(2) + 'ms' : '0.00ms'
  };
}

/**
 * Calculate CPU usage as fraction of available cores (0-N scale)
 * Returns the vCPU usage where 1.0 = one full CPU core
 */
function getProcessCpuUsage(): { percentage: number, cores: number, usedVCores: number } {
  const currentCpuUsage = process.cpuUsage();
  const currentTime = Date.now();
  
  // Calculate CPU time difference
  const userDiff = currentCpuUsage.user - lastCpuUsage.user;
  const systemDiff = currentCpuUsage.system - lastCpuUsage.system;
  const timeDiff = (currentTime - lastCpuTime) * 1000; // Convert to microseconds
  
  // Update last measurements
  lastCpuUsage = currentCpuUsage;
  lastCpuTime = currentTime;
  
  // Calculate percentage across all cores
  const cpuPercent = (userDiff + systemDiff) / timeDiff;
  
  const cpuCores = os.cpus().length;
  const usedVCores = cpuPercent * cpuCores;
  
  return {
    percentage: cpuPercent * 100,
    cores: cpuCores,
    usedVCores: parseFloat(usedVCores.toFixed(2))
  };
}

/**
 * Format bytes to MB for consistency in the metrics output
 */
function formatBytesToMB(bytes: number): number {
  return parseFloat((bytes / (1024 * 1024)).toFixed(2));
}

/**
 * Format bytes to human-readable format with unit
 */
function formatBytes(bytes: number, preferredUnit: string = ''): { value: number, unit: string } {
  const units = ['B', 'KB', 'MB', 'GB'];
  
  if (preferredUnit && units.includes(preferredUnit)) {
    // Convert to preferred unit
    const unitIndex = units.indexOf(preferredUnit);
    let value = bytes;
    for (let i = 0; i < unitIndex; i++) {
      value /= 1024;
    }
    return {
      value: parseFloat(value.toFixed(2)),
      unit: preferredUnit
    };
  }
  
  // Standard conversion
  let value = bytes;
  let unitIndex = 0;
  
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  
  return {
    value: parseFloat(value.toFixed(2)), 
    unit: units[unitIndex]
  };
}

/**
 * Calculate memory usage trend
 * Returns 'stable', 'increasing', or 'decreasing'
 */
function getMemoryTrend(): { trend: string, change: number } {
  if (memoryHistory.length < 3) return { trend: 'stable', change: 0 };
  
  // Calculate the slope of recent memory usage
  const recent = memoryHistory.slice(-3);
  const firstVal = recent[0];
  const lastVal = recent[recent.length - 1];
  const change = ((lastVal - firstVal) / firstVal) * 100;
  
  if (change > 5) return { trend: 'increasing', change: parseFloat(change.toFixed(1)) };
  if (change < -5) return { trend: 'decreasing', change: parseFloat(change.toFixed(1)) };
  return { trend: 'stable', change: parseFloat(change.toFixed(1)) };
}

/**
 * Get enhanced metrics including vCPU usage and formatted memory values
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    // Check for simplified view parameter
    const simplified = req.query.simple === 'true';
    const detailed = req.query.detailed === 'true';
    
    // Get process memory usage
    const memUsage = process.memoryUsage();
    
    // Store current RSS memory usage in history
    const currentRssMemoryMB = formatBytesToMB(memUsage.rss);
    memoryHistory.push(currentRssMemoryMB);
    
    // Keep history at max size
    if (memoryHistory.length > MEMORY_HISTORY_SIZE) {
      memoryHistory.shift();
    }
    
    // Get memory trend
    const memoryTrend = getMemoryTrend();
    
    // Get CPU usage as vCPU
    const cpuUsage = getProcessCpuUsage();
    
    // Get OS memory information
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    
    // Format memory values consistently in MB
    const rss = formatBytes(memUsage.rss, 'MB');
    const heapTotal = formatBytes(memUsage.heapTotal, 'MB');
    const heapUsed = formatBytes(memUsage.heapUsed, 'MB');
    const external = formatBytes(memUsage.external, 'MB');
    
    // Get browser metrics (if available)
    const browserMetrics = await browserManager.getBrowserMetrics();
    
    // Calculate system load average per core
    const loadAvg = os.loadavg();
    const loadPerCore = loadAvg.map(load => parseFloat((load / os.cpus().length).toFixed(2)));
    
    // Format browser memory if available
    let browserMemoryMetrics = {};
    let contextMetrics: ContextMetric[] = [];
    
    if (browserMetrics?.memoryUsage) {
      const bm = browserMetrics.memoryUsage;
      browserMemoryMetrics = {
        total: formatBytes(bm.total, 'MB'),
        free: formatBytes(bm.free, 'MB'),
        processUsed: formatBytes(bm.processUsed, 'MB')
      };
      
      // Add memory pressure indicator
      browserMemoryMetrics = {
        ...browserMemoryMetrics,
        pressure: isMemoryPressureHigh() ? 'high' : 'normal',
        trend: memoryTrend.trend,
        changePercent: memoryTrend.change
      };
      
      // Try to get browser cache information if available
      const browser = browserManager.getBrowser();
      if (!simplified && browser) {
        try {
          const contexts = await browser.contexts();
          
          // Get detailed metrics about each context if detailed flag is set
          if (detailed) {
            contextMetrics = await Promise.all(contexts.map(async (context, index) => {
              try {
                const pages = await context.pages();
                return {
                  id: index,
                  pagesCount: pages.length,
                  urls: detailed ? await Promise.all(pages.map(async p => {
                    try {
                      return await p.url();
                    } catch (e) {
                      return 'unknown';
                    }
                  })) : []
                };
              } catch (e) {
                return { id: index, pagesCount: 0, urls: [] };
              }
            }));
          } else {
            // Just count pages in each context
            contextMetrics = await Promise.all(contexts.map(async (context, index) => {
              try {
                const pages = await context.pages();
                return { id: index, pagesCount: pages.length };
              } catch (e) {
                return { id: index, pagesCount: 0 };
              }
            }));
          }
          
          if (contexts.length > 0) {
            const page = contexts[0].pages()[0];
            if (page) {
              const cacheStats = await page.evaluate(() => {
                // Try to estimate cache size from performance entries
                const resources = performance.getEntriesByType('resource');
                const totalCacheSize = resources.reduce((total, resource) => {
                  // Approximate size based on transferSize and decodedBodySize
                  const resourceSize = (resource as any).transferSize || 0;
                  return total + resourceSize;
                }, 0);
                
                return {
                  cachedResources: resources.length,
                  estimatedCacheSize: totalCacheSize
                };
              }).catch(() => null);
              
              if (cacheStats) {
                browserMemoryMetrics = {
                  ...browserMemoryMetrics,
                  cache: {
                    resourceCount: cacheStats.cachedResources,
                    estimatedSize: formatBytes(cacheStats.estimatedCacheSize, 'MB')
                  }
                };
              }
            }
          }
        } catch (e) {
          // Ignore errors when trying to get cache info
        }
      }
    }
    
    // Format queue metrics
    const queueMetrics = getQueueMetrics(requestQueue);
    
    if (simplified) {
      // Return a simplified version of metrics with just the key data
      const simplifiedMetrics = {
        uptime: formatUptime(Date.now() - startTime),
        cpu: {
          usedVCores: cpuUsage.usedVCores,
          cores: cpuUsage.cores
        },
        memory: {
          used: `${rss.value} ${rss.unit}`,
          total: `${formatBytes(totalMem, 'MB').value} MB`,
          trend: memoryTrend.trend,
          pressure: isMemoryPressureHigh() ? 'high' : 'normal'
        },
        browser: {
          active: browserMetrics?.activeRequests || 0,
          contexts: browserMetrics?.totalContexts || 0,
          pages: browserMetrics?.totalPages || 0
        },
        queue: {
          active: queueMetrics.active,
          pending: queueMetrics.pending
        }
      };
      
      return res.json(simplifiedMetrics);
    }
    
    // Return the full metrics
    const metrics = {
      timestamp: new Date().toISOString(),
      uptime: formatUptime(Date.now() - startTime),
      cpu: {
        usage: cpuUsage,
        loadAverage: loadAvg,
        loadPerCore: loadPerCore
      },
      memory: {
        process: {
          rss: `${rss.value} ${rss.unit}`,
          heapTotal: `${heapTotal.value} ${heapTotal.unit}`,
          heapUsed: `${heapUsed.value} ${heapUsed.unit}`,
          external: `${external.value} ${external.unit}`,
          trend: memoryTrend.trend,
          changePercent: memoryTrend.change
        },
        system: {
          total: `${formatBytes(totalMem).value} ${formatBytes(totalMem).unit}`,
          free: `${formatBytes(freeMem).value} ${formatBytes(freeMem).unit}`,
          used: `${formatBytes(totalMem - freeMem).value} ${formatBytes(totalMem - freeMem).unit}`,
          percentUsed: parseFloat(((totalMem - freeMem) / totalMem * 100).toFixed(1))
        }
      },
      browser: {
        activeRequests: browserMetrics?.activeRequests || 0,
        totalContexts: browserMetrics?.totalContexts || 0,
        availableContexts: browserMetrics?.availableContexts || 0,
        totalPages: browserMetrics?.totalPages || 0,
        memory: browserMemoryMetrics,
        contexts: contextMetrics,
        pagesProcessed: browserMetrics?.totalPagesProcessed || 0
      },
      queue: queueMetrics
    };
    
    return res.json(metrics);
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to get metrics',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Format uptime in days, hours, minutes, seconds
 */
function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  const remainingHours = hours % 24;
  const remainingMinutes = minutes % 60;
  const remainingSeconds = seconds % 60;
  
  let uptimeString = '';
  if (days > 0) uptimeString += `${days}d `;
  if (remainingHours > 0 || days > 0) uptimeString += `${remainingHours}h `;
  if (remainingMinutes > 0 || remainingHours > 0 || days > 0) uptimeString += `${remainingMinutes}m `;
  uptimeString += `${remainingSeconds}s`;
  
  return uptimeString;
}

export default router; 