import { chromium, Browser, BrowserContext, Page, type Route } from 'playwright';

import genericPool from 'generic-pool';
import EventEmitter from 'events';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import winston from 'winston';

// Use inline definition instead of import
const execAsync = promisify(exec);

// Create a logger
const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'browser-manager' },
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

interface BrowserMetrics {
  activeRequests: number;
  availableContexts: number;
  totalContexts: number;
  cpuUsage: number;
  memoryUsage: {
    total: number;
    free: number;
    processUsed: number;
  };
  totalPages: number;
  maxPagesInContext: number;
  avgPagesPerContext: number;
  totalPagesProcessed: number;
}

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
  
  // Truncate long text
  if (content.length > 500) {
    return content.substring(0, 500) + '... [truncated]';
  }
  
  return content;
}

// Update your domain comparison logic to handle www/non-www variants


class BrowserManager extends EventEmitter {
  private browser: Browser | null = null;
  private contextPool!: genericPool.Pool<BrowserContext>;
  private activeRequests: number = 0;
  private isShuttingDown: boolean = false;
  private metricsInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  public isInitialized: boolean = false;
  
  // Track pages per context
  private pagesPerContext: Map<BrowserContext, number> = new Map();
  
  // Optimized timeouts and limits - updated based on requirements
  private readonly MAX_CONTEXTS = 20;  // Increased to 20
  private readonly MIN_CONTEXTS = 2;   // Increased to 2
  private readonly MAX_PAGES_PER_CONTEXT = 10; // Increased to 10 for better efficiency
  private readonly METRICS_INTERVAL = 10000;
  private readonly PAGE_TIMEOUT = 30000;
  private readonly NAVIGATION_TIMEOUT = 30000;
  private readonly CONTEXT_TIMEOUT = 30000;
  private readonly BROWSER_RESTART_THRESHOLD = 1000; // Restart browser after 1000 pages
  private totalPagesProcessed: number = 0;

  public pagePool!: genericPool.Pool<Page>;

  constructor() {
    super();
    this.initializeAsync();
  }

  private async initializeAsync() {
    const maxRetries = 3;
    let retryCount = 0;
    
    while (retryCount < maxRetries) {
      try {
        logger.info(`Starting Browser Manager initialization (attempt ${retryCount + 1}/${maxRetries})...`);
        
        // First initialize the browser
        await this.initializeBrowser();
        logger.info('Browser initialized successfully');
        
        // Create and configure the context pool
        this.contextPool = this.createContextPool();
        logger.info('Context pool created');
        
        // Start metrics monitoring
        this.initializeMetricsMonitoring();
        this.setupEventListeners();
        logger.info('Monitoring initialized');
        
        // Start the pool
        await this.contextPool.start();
        logger.info('Pool started');
        
        // Initialize first context with timeout
        let initialContextSuccess = false;
        
        try {
          logger.info('Creating initial test context...');
          const context = await Promise.race([
            this.contextPool.acquire(),
            new Promise<never>((_, reject) => 
              setTimeout(() => reject(new Error('Initial context creation timeout')), 15000)
            )
          ]);
          
          if (context) {
            // Test the context
            const testPage = await context.newPage();
            await testPage.close();
            
            // Release it back
            await this.contextPool.release(context);
            initialContextSuccess = true;
            logger.info('Initial context created and tested successfully');
          }
        } catch (error) {
          logger.error('Error creating initial test context:', error);
          // Continue anyway - the pool can create contexts on demand
        }
        
        this.isInitialized = true;
        logger.info('Browser Manager initialization complete');
        
        // Only create page pool if context pool is working
        if (initialContextSuccess) {
          // Create a pool of pages from this browser instance
          this.pagePool = genericPool.createPool({
            create: async () => {
              // Check if browser is initialized
              if (!this.browser) {
                throw new Error('Browser not initialized');
              }
              // Create a new browser context for isolation and its page
              const context = await this.browser.newContext();
              const page = await context.newPage();
              await this.setupPageRouting(page);
              return page;
            },
            destroy: async (page: Page) => {
              // Close the page and its context on destroy
              const context = page.context();
              try { await page.close(); } catch (e) { }
              try { await context.close(); } catch (e) { }
            }
          }, { min: 1, max: 10 }); // Tune these values as needed
        }
        
        // Set up idle cleanup timer - this will clean up resources even when no requests are active
        // This runs every 5 minutes and checks if we should clean up resources
        setInterval(async () => {
          try {
            // Only do cleanup if no active requests or few active requests
            if (this.activeRequests <= 1) {
              const memInfo = process.memoryUsage();
              const memUsageMB = Math.round(memInfo.rss / (1024 * 1024));
              
              // If memory usage is above threshold, perform cleanup
              if (memUsageMB > 500) { // 500MB threshold
                logger.info(`Idle cleanup triggered. Memory usage: ${memUsageMB}MB with ${this.activeRequests} active requests`);
                
                // Release unused contexts first
                const releasedCount = await this.releaseUnusedContexts();
                
                // If memory is still high and no contexts were released, restart browser
                if (memUsageMB > 800 && releasedCount === 0 && !this.isShuttingDown) {
                  await this.forceCleanupAndRestart();
                }
                // Otherwise just trigger GC
                else if (global.gc) {
                  global.gc();
                  logger.info('Garbage collection triggered during idle cleanup');
                }
              }
            }
          } catch (error) {
            logger.error('Error in idle cleanup timer:', error);
          }
        }, 5 * 60 * 1000); // Every 5 minutes
        
        // Successful initialization
        return;
      } catch (error) {
        retryCount++;
        logger.error(`Browser Manager initialization failed (attempt ${retryCount}/${maxRetries}):`, error);
        
        // Clean up failed attempts
        if (this.contextPool) {
          try {
            this.contextPool.drain().catch(e => logger.error('Error draining pool during retry:', e));
          } catch (e) {
            // Ignore
          }
        }
        
        if (this.browser) {
          try {
            await this.browser.close().catch(() => {});
            this.browser = null;
          } catch (e) {
            // Ignore
          }
        }
        
        // Only retry if we haven't reached max retries
        if (retryCount >= maxRetries) {
          this.isInitialized = false;
          logger.error('Browser Manager initialization failed after maximum retry attempts');
          throw error;
        }
        
        // Wait before retry
        const delayMs = 2000 * retryCount;
        logger.info(`Waiting ${delayMs}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  private createContextPool(): genericPool.Pool<BrowserContext> {
    return genericPool.createPool<BrowserContext>({
      create: async () => {
        if (!await this.checkBrowserHealth()) {
          throw new Error('Browser is not healthy');
        }

        if (!this.browser) throw new Error('Browser not initialized');
        
        // Create new context
        const context = await this.browser.newContext({
          viewport: { width: 1280, height: 720 },
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          bypassCSP: true,
          ignoreHTTPSErrors: true,
          offline: false,
          javaScriptEnabled: true
        });
        
        // Set timeouts
        await context.setDefaultTimeout(this.PAGE_TIMEOUT);
        await context.setDefaultNavigationTimeout(this.NAVIGATION_TIMEOUT);
        
        return context;
      },
      destroy: async (context: BrowserContext) => {
        try {
          await context.close().catch(() => {});
        } catch (error) {
          logger.error('Error closing context during destroy:', error);
        }
      },
      validate: async (context: BrowserContext): Promise<boolean> => {
        try {
          // Simpler validation - just check if it exists and has the expected methods
          return !!context && typeof context.newPage === 'function';
        } catch (error) {
          return false;
        }
      }
    }, {
      max: this.MAX_CONTEXTS,
      min: this.MIN_CONTEXTS,
      acquireTimeoutMillis: 30000, // Increase timeout to 30 seconds
      evictionRunIntervalMillis: 30000, // Run eviction less frequently
      numTestsPerEvictionRun: 2,
      softIdleTimeoutMillis: 30000, // Longer idle timeout
      idleTimeoutMillis: 60000, // Longer idle timeout
      testOnBorrow: true,
      autostart: false
    });
  }

  private async initializeBrowser(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (error) {
        logger.error('Error closing existing browser:', error);
      }
    }

    try {
      logger.info('Launching Playwright Chromium browser...');
      
      this.browser = await chromium.launch({
        headless: true,
        //executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-background-networking',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-breakpad',
          '--disable-component-extensions-with-background-pages',
          '--disable-features=TranslateUI,BlinkGenPropertyTrees',
          '--disable-ipc-flooding-protection',
          '--disable-renderer-backgrounding',
        ],
        ignoreDefaultArgs: ['--enable-automation'],
      });

      if (!this.browser) {
        throw new Error('Failed to launch Playwright Chromium browser');
      }

      // Test browser is working
      const testContext = await this.browser.newContext();
      const testPage = await testContext.newPage();
      await testContext.close();

      logger.info('Playwright Chromium browser initialized successfully');
      
      this.browser.on('disconnected', this.handleBrowserDisconnect.bind(this));
      
      // Reset the counter for pages processed
      this.totalPagesProcessed = 0;

      // In the constructor or initializeBrowser method
      this.cleanupInterval = setInterval(() => {
        this.periodicCleanup();
      }, 5 * 60 * 1000); // Every 5 minutes
    } catch (error) {
      logger.error('Failed to initialize Playwright browser:', error);
      throw error;
    }
  }

  private handleBrowserDisconnect(): void {
    logger.error('Browser disconnected unexpectedly!');
    this.emit('browser-disconnected');
    
    // Trigger browser reinitialization
    setTimeout(async () => {
      logger.info('Attempting to recover browser after disconnection...');
      try {
        await this.initializeBrowser();
        logger.info('Browser recovered successfully after disconnection');
      } catch (error) {
        logger.error('Failed to recover browser after disconnection:', error);
      }
    }, 1000);
  }

  private setupEventListeners(): void {
    this.on('error', (error: Error) => {
      logger.error('BrowserManager error:', error);
    });

    process.on('SIGTERM', this.shutdown.bind(this));
    process.on('SIGINT', this.shutdown.bind(this));
  }

  private initializeMetricsMonitoring(): void {
    this.metricsInterval = setInterval(async () => {
      try {
        const metrics = await this.getMetrics();
        // Don't log metrics unless in debug mode
        if (process.env.LOG_LEVEL === 'debug') {
          this.logFormattedMetrics(metrics);
        }
        await this.autoScale(metrics);
        
        // Memory management improvements
        const memoryThresholdMB = 500; // 500MB
        const criticalMemoryThresholdMB = 1500; // 1.5GB
        
        // Determine the memory pressure level
        const memUsageMB = metrics.memoryUsage.processUsed / (1024 * 1024);
        
        if (memUsageMB > criticalMemoryThresholdMB) {
          // Critical memory pressure - take aggressive action
          logger.warn(`Critical memory pressure detected: ${Math.round(memUsageMB)}MB used`);
          
          // Aggressively release contexts
          const releasedCount = await this.releaseUnusedContexts();
          
          // Force immediate garbage collection
          if (global.gc) {
            global.gc();
            logger.info('Forced garbage collection due to critical memory pressure');
            
            // If memory is still high and we couldn't release contexts, consider restarting browser
            setTimeout(async () => {
              const updatedMetrics = await this.getMetrics();
              const updatedMemUsageMB = updatedMetrics.memoryUsage.processUsed / (1024 * 1024);
              
              if (updatedMemUsageMB > criticalMemoryThresholdMB && releasedCount === 0 && !this.isShuttingDown) {
                logger.warn('Memory still critical after cleanup, scheduling browser restart');
                this.scheduleBackgroundBrowserRestart();
              }
            }, 2000);
          }
        } 
        else if (memUsageMB > memoryThresholdMB) {
          // Moderate memory pressure
          logger.debug(`High memory usage detected: ${Math.round(memUsageMB)}MB used`);
          
          // Try to release some contexts
          await this.releaseUnusedContexts();
          
          // Request garbage collection
          if (global.gc) {
            global.gc();
            logger.debug('Garbage collection requested due to high memory usage');
          }
        }
      } catch (error) {
        logger.error('Error collecting metrics:', error);
      }
    }, this.METRICS_INTERVAL);
  }

  private logFormattedMetrics(metrics: BrowserMetrics): void {
   
    
    const formatBytes = (bytes: number): string => {
      const units = ['B', 'KB', 'MB', 'GB'];
      let size = bytes;
      let unitIndex = 0;
      while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
      }
      return `${size.toFixed(2)} ${units[unitIndex]}`;
    };

    logger.debug('\n=== Browser Manager Status ===');
    logger.debug(`Time: ${new Date().toLocaleTimeString()}`);
    logger.debug('\nRequest Status:');
    logger.debug(`• Active Requests: ${metrics.activeRequests}`);
    logger.debug(`• Browser Contexts: ${metrics.totalContexts} (${metrics.availableContexts} available)`);
    logger.debug(`• Pages: Total: ${metrics.totalPages}, Max per context: ${metrics.maxPagesInContext.toFixed(2)}, Avg per context: ${metrics.avgPagesPerContext.toFixed(2)}`);
    
    logger.debug('\nSystem Resources:');
    logger.debug(`• CPU Usage: ${(metrics.cpuUsage * 100).toFixed(2)}%`);
    logger.debug(`• Memory: ${formatBytes(metrics.memoryUsage.processUsed)} / ${formatBytes(metrics.memoryUsage.total)} (${formatBytes(metrics.memoryUsage.free)} free)`);
    logger.debug('===========================\n');
  }

  public async getMetrics(): Promise<BrowserMetrics> {
    if (!this.browser) {
      // Return default metrics instead of null
      return {
        activeRequests: this.activeRequests,
        availableContexts: this.MAX_CONTEXTS - this.activeRequests,
        totalContexts: this.MAX_CONTEXTS,
        cpuUsage: 0,
        memoryUsage: {
          total: os.totalmem(),
          free: os.freemem(),
          processUsed: 0
        },
        totalPages: 0,
        maxPagesInContext: 0,
        avgPagesPerContext: 0,
        totalPagesProcessed: this.totalPagesProcessed
      };
    }
    
    try {
      // Get all browser contexts
      const contexts = await this.browser.contexts();
      
      // Calculate total pages
      const pagesPerContext = await Promise.all(
        contexts.map(async ctx => (await ctx.pages()).length)
      );
      
      const totalPages = pagesPerContext.reduce((sum, count) => sum + count, 0);
      const maxPagesInContext = Math.max(0, ...pagesPerContext);
      const avgPagesPerContext = contexts.length > 0 
        ? parseFloat((totalPages / contexts.length).toFixed(2)) 
        : 0;
      
      // Get browser process information
      let cpuUsage = 0;
      let memoryUsage = {
        total: os.totalmem(),
        free: os.freemem(),
        processUsed: 0
      };
      
      // Use a safer approach to get browser process information
      try {
        // Get process information based on platform
        if (process.platform === 'linux' || process.platform === 'darwin') {
          // For Linux/macOS, use ps command to get browser process info
          // First get all chrome/chromium processes
          const { stdout: processListOutput } = await execAsync('ps -ef | grep -i chrome');
          
          // Parse process list to find browser processes
          const processLines = processListOutput.split('\n');
          let browserPids: number[] = [];
          
          // Look for chromium/chrome processes (excluding grep itself)
          for (const line of processLines) {
            if (line.includes('chromium') || line.includes('chrome')) {
              // Skip grep process
              if (line.includes('grep -i chrome')) continue;
              
              // Extract PID (usually the 2nd column in ps output)
              const parts = line.trim().split(/\s+/);
              if (parts.length >= 2) {
                const pid = parseInt(parts[1]);
                if (!isNaN(pid)) {
                  browserPids.push(pid);
                }
              }
            }
          }
          
          // If we found browser processes, check their CPU usage
          if (browserPids.length > 0) {
            // Get CPU usage for the first browser process found
            const pidToCheck = browserPids[0];
            const { stdout } = await execAsync(`ps -p ${pidToCheck} -o %cpu,%mem`);
            const lines = stdout.trim().split('\n');
            if (lines.length > 1) {
              const values = lines[1].trim().split(/\s+/);
              cpuUsage = parseFloat(values[0]) / 100; // Convert percentage to decimal
              
              // Also get memory usage if available
              if (values.length > 1) {
                // Calculate memory usage based on percentage of total
                const memPercent = parseFloat(values[1]) / 100;
                memoryUsage.processUsed = Math.round(memoryUsage.total * memPercent);
              }
            }
          }
        } 
        else if (process.platform === 'win32') {
          // For Windows, use wmic (note: this is deprecated in newer Windows versions)
          try {
            // Try to find chrome processes
            const { stdout: processList } = await execAsync('wmic process where "name like \'%chrome%\'" get processid,workingsetsize');
            const lines = processList.trim().split('\n');
            
            if (lines.length > 1) {
              // Skip header line and process first chrome process found
              const parts = lines[1].trim().split(/\s+/);
              if (parts.length >= 2) {
                // Last part should be the PID, before that is memory
                const pid = parts[parts.length - 1];
                const memory = parts[parts.length - 2];
                
                // Set memory usage
                memoryUsage.processUsed = parseInt(memory);
                
                // Get CPU usage with another command
                const { stdout: cpuData } = await execAsync(`wmic process where processid=${pid} get cpuusage`);
                const cpuLines = cpuData.trim().split('\n');
                if (cpuLines.length > 1) {
                  cpuUsage = parseInt(cpuLines[1].trim()) / 100;
                }
              }
            }
          } catch (e) {
            // Fallback to process.memoryUsage for some estimate
            const processMemInfo = process.memoryUsage();
            memoryUsage.processUsed = processMemInfo.rss;
          }
        }
        
        // If we still don't have process memory, use Node's memory as approximation
        if (!memoryUsage.processUsed) {
          const processMemInfo = process.memoryUsage();
          memoryUsage.processUsed = processMemInfo.rss;
        }
      } catch (e) {
        logger.error('Error getting browser process metrics:', e);
        // Fallback to process.memoryUsage if all else fails
        const processMemInfo = process.memoryUsage();
        memoryUsage.processUsed = processMemInfo.rss;
      }
      
      return {
        activeRequests: this.activeRequests,
        availableContexts: this.MAX_CONTEXTS - this.activeRequests,
        totalContexts: this.MAX_CONTEXTS,
        cpuUsage,
        memoryUsage,
        totalPages,
        maxPagesInContext,
        avgPagesPerContext,
        totalPagesProcessed: this.totalPagesProcessed
      };
    } catch (e) {
      logger.error('Error getting browser metrics:', e);
      // Return default metrics instead of error object
      return {
        activeRequests: this.activeRequests,
        availableContexts: this.MAX_CONTEXTS - this.activeRequests,
        totalContexts: this.MAX_CONTEXTS,
        cpuUsage: 0,
        memoryUsage: {
          total: os.totalmem(),
          free: os.freemem(),
          processUsed: 0
        },
        totalPages: 0,
        maxPagesInContext: 0,
        avgPagesPerContext: 0,
        totalPagesProcessed: this.totalPagesProcessed
      };
    }
  }

  private async autoScale(metrics: BrowserMetrics): Promise<void> {
    const requestsPerContext = metrics.activeRequests / metrics.totalContexts;
    
    // Only create new contexts if we're really under pressure (multiple requests per context)
    if (requestsPerContext > this.MAX_PAGES_PER_CONTEXT && metrics.totalContexts < this.MAX_CONTEXTS) {
      await this.contextPool.start();
    }
    
    // REMOVED the drain/clear logic that was causing "pool is draining" errors
    // Never drain the main pool during normal operation - this breaks subsequent requests
    
    // Optional: If you need to manage pool size, just use destroy on individual contexts
    // rather than draining the whole pool
  }

  // Get the context with the fewest active pages
  private async getLeastBusyContext(): Promise<BrowserContext> {
    try {
      // Check if pool is draining and reset if needed
      await this.ensurePoolIsNotDraining();
      
      // Add retry logic for acquiring context
      let attempts = 0;
      const maxAttempts = 3;
      
      while (attempts < maxAttempts) {
        try {
          return await this.contextPool.acquire();
        } catch (error) {
          attempts++;
          // If we got a "pool is draining" error, try to reset the pool
          if (error instanceof Error && error.message.includes('pool is draining')) {
            logger.info('Pool is draining, attempting to reset...');
            await this.ensurePoolIsNotDraining();
          }
          
          if (attempts === maxAttempts) throw error;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      throw new Error('Failed to acquire context after retries');
    } catch (error) {
      logger.error('Error finding least busy context:', error);
      // If we still can't get a context, reinitialize the pool
      if (error instanceof Error && error.message.includes('pool is draining')) {
        await this.resetContextPool();
      }
      // Try one more time with direct acquire
      return await this.contextPool.acquire();
    }
  }

  // Ensure the pool is not in a draining state
  private async ensurePoolIsNotDraining(): Promise<void> {
    try {
      // Use private property access to check if pool is draining
      // @ts-ignore - we need to access private property
      if (this.contextPool._draining) {
        logger.info('Context pool was in draining state, resetting...');
        await this.resetContextPool();
      }
    } catch (error) {
      logger.error('Error checking if pool is draining:', error);
    }
  }

  // Reset context pool if needed
  private async resetContextPool(): Promise<void> {
    try {
      logger.info('Resetting context pool...');
      
      // Try to clear old pool if possible
      try {
        if (this.contextPool) {
          // Drain without waiting - just mark for draining
          this.contextPool.drain().catch(e => logger.error('Error draining old pool:', e));
        }
      } catch (e) {
        logger.error('Error preparing old pool for reset:', e);
      }
      
      // Create a new pool
      this.contextPool = this.createContextPool();
      
      // Start the pool
      await this.contextPool.start();
      logger.info('New context pool created and started');
      
      // Create initial contexts one by one with proper error handling
      logger.info(`Creating ${this.MIN_CONTEXTS} initial contexts...`);
      let successCount = 0;
      
      for (let i = 0; i < this.MIN_CONTEXTS; i++) {
        try {
          // Use a timeout to prevent hanging
          const context = await Promise.race([
            this.contextPool.acquire(),
            new Promise<never>((_, reject) => 
              setTimeout(() => reject(new Error('Context creation timeout')), 10000)
            )
          ]);
          
          if (context) {
            // Successfully acquired a context, now release it back
            await this.contextPool.release(context);
            successCount++;
            logger.info(`Created initial context ${successCount}/${this.MIN_CONTEXTS}`);
          }
        } catch (error) {
          logger.error(`Failed to create initial context ${i+1}/${this.MIN_CONTEXTS}:`, error);
        }
      }
      
      logger.info(`Context pool reset complete (created ${successCount}/${this.MIN_CONTEXTS} contexts)`);
    } catch (error) {
      logger.error('Failed to reset context pool:', error);
    }
  }

  async withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    // Track this request
    this.activeRequests++;
    
    // For tracking execution time
    const startTime = Date.now();
    
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    let reusingPage = false; // Boolean to track if we're reusing a page from the pool
    
    try {
      // Make sure the pool isn't being drained
      await this.ensurePoolIsNotDraining();
      
      // Try to reuse existing page from pool if available
      try {
        if (this.pagePool && Math.random() > 0.2) { // 80% chance to try page reuse
          // Try to get a page from the pool with a short timeout
          const pooledPage = await Promise.race([
            this.pagePool.acquire(),
            new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Page pool timeout')), 500))
          ]);
          
          if (pooledPage) {
            page = pooledPage;
            reusingPage = true;
            
            // Clear and reset the page with error handling
            try {
              await Promise.all([
                page.evaluate(() => {
                  try {
                    localStorage.clear();
                  } catch (e) {
                    // Ignore localStorage errors
                  }
                  try {
                    sessionStorage.clear();
                  } catch (e) {
                    // Ignore sessionStorage errors
                  }
                  window.scrollTo(0, 0);
                  return true;
                })
              ]);
              
              // Reset cookies and cache (but only do this occasionally to save time)
              if (Math.random() > 0.7) { // 30% chance to clear cookies
                await page.context().clearCookies();
              }
            } catch (e) {
              logger.debug(`Error resetting page: ${e}`);
              // Continue anyway - this isn't critical
            }
          }
        }
      } catch (e) {
        // If page pool access fails, we'll create a page the normal way
        logger.debug(`Page pool access failed: ${e}`);
      }
      
      // If we couldn't get a page from the pool, create a new one
      if (!page) {
        // Get a browser context from the pool
        context = await this.getLeastBusyContext();
        
        if (!context) {
          throw new Error('Failed to acquire browser context');
        }
        
        logger.debug('Creating new page...');
        
        // Create a page with timeout safeguard
        page = await Promise.race([
          context.newPage(),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Page creation timeout')), this.PAGE_TIMEOUT)
          )
        ]);
        
        // Increment page count for this context
        this.pagesPerContext.set(context, (this.pagesPerContext.get(context) || 0) + 1);
        
        // Set up page routing
        await this.setupPageRouting(page);
      }
      
      // Configure page settings
      await page.setDefaultNavigationTimeout(this.NAVIGATION_TIMEOUT);
      await page.setDefaultTimeout(this.PAGE_TIMEOUT);
      
      // Execute the provided function with our page
      const result = await fn(page);
      
      // Calculate and log execution time
      const executionTime = Date.now() - startTime;
      logger.debug(`Request completed successfully in ${executionTime}ms`);
      
      // Increment total pages counter
      this.totalPagesProcessed++;
      
      // Check if it's time to restart browser to prevent memory issues
      if (this.totalPagesProcessed >= this.BROWSER_RESTART_THRESHOLD) {
        logger.info(`Reached ${this.totalPagesProcessed} processed pages, scheduling background browser restart`);
        this.scheduleBackgroundBrowserRestart();
      }
      
      return result;
      
    } catch (error) {
      // Log the error
      logger.error('Error in withPage:', error);
      throw error;
      
    } finally {
      try {
        // Use the improved cleanup method for both pooled and regular pages
        if (page) {
          if (reusingPage) {
            try {
              // For pooled pages, just reset and return to pool
              await page.evaluate(() => {
                try { localStorage.clear(); } catch (e) {}
                try { sessionStorage.clear(); } catch (e) {}
                window.scrollTo(0, 0);
                return true;
              }).catch(() => {});
              
              // Return to pool
              await this.pagePool.release(page);
            } catch (e) {
              logger.error('Error returning page to pool, will close it instead:', e);
              // If pool release fails, use our cleanup page method
              await this.cleanupPage(page);
            }
          } else {
            // For regular pages, use the comprehensive cleanup approach
            await this.cleanupPage(page);
          }
        }
        
        // Release the context back to the pool if we got one directly (not through page pool)
        if (context && !reusingPage) {
          try {
            await this.contextPool.release(context);
          } catch (e) {
            logger.error('Error releasing context to pool:', e);
          }
        }
        
        // Decrement active requests counter
        this.activeRequests--;
        
        // Periodically check memory and release unused contexts if needed
        if (Math.random() < 0.05) { // 5% chance on each page completion
          const memoryUsage = process.memoryUsage();
          if (memoryUsage.rss > 1.5 * 1024 * 1024 * 1024) { // If over 1.5GB
            this.releaseUnusedContexts();
          }
        }
      } catch (e) {
        logger.error('Error in withPage cleanup:', e);
        this.activeRequests--;
      }
    }
  }

  /**
   * Set up page routing and tracking for proper cleanup
   */
  private async setupPageRouting(page: Page) {
    await page.route('**/*', async (route: Route) => {
      const request = route.request();
      const resourceType = request.resourceType();
      const url = request.url();
      
      // Block OneTrust and cookie-related resources
      if (url.includes('onetrust') || 
          url.includes('cookielaw') || 
          url.includes('cookie-consent') ||
          url.includes('cookie-policy') ||
          url.includes('privacy-policy') ||
          url.includes('gdpr')) {
        await route.abort();
        return;
      }
      
      // Allow essential resources and main stylesheets
      if (resourceType === 'document' || 
          resourceType === 'script' || 
          resourceType === 'stylesheet' || 
          resourceType === 'fetch' || 
          resourceType === 'xhr') {
        await route.continue();
      } else if (resourceType === 'image' && url.includes('logo')) {
        // Allow logo images
        await route.continue();
      } else {
        // Block non-essential resources
        await route.abort();
      }
    });
    
    // Add event listener for page close to ensure cleanup
    page.on('close', () => {
      const context = page.context();
      // Update page count for this context
      const currentCount = this.pagesPerContext.get(context) || 0;
      if (currentCount > 0) {
        this.pagesPerContext.set(context, currentCount - 1);
      } else {
        this.pagesPerContext.delete(context);
      }
      
      // If context has no pages, consider closing it
      if (currentCount <= 1) {
        this.tryCloseEmptyContext(context).catch(() => {});
      }
    });
    
    // Track this page in its context
    const context = page.context();
    const currentCount = this.pagesPerContext.get(context) || 0;
    this.pagesPerContext.set(context, currentCount + 1);
  }

  /**
   * Try to close an empty context
   */
  private async tryCloseEmptyContext(context: BrowserContext): Promise<boolean> {
    try {
      const pages = await context.pages();
      if (pages.length === 0) {
        await context.close();
        this.pagesPerContext.delete(context);
        return true;
      }
    } catch (e) {
      // Context might already be closed
    }
    return false;
  }

  public async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      logger.info('Shutdown already in progress');
      return;
    }
    
    this.isShuttingDown = true;
    logger.info('Starting BrowserManager shutdown...');
    
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    try {
      // Clear the page tracking
      this.pagesPerContext.clear();
      
      // Drain and clear pools
      if (this.contextPool) {
        logger.info('Draining context pool...');
        await this.contextPool.drain();
        await this.contextPool.clear();
      }
      
      if (this.pagePool) {
        logger.info('Draining page pool...');
        await this.pagePool.drain();
        await this.pagePool.clear();
      }
      
      // Close browser
      if (this.browser) {
        logger.info('Closing browser...');
        await this.browser.close();
        this.browser = null;
      }
      
      logger.info('BrowserManager shutdown completed successfully');
    } catch (error) {
      logger.error('Error during BrowserManager shutdown:', error);
      throw error;
    }
  }

  // Add a new method to check browser health
  private async checkBrowserHealth(): Promise<boolean> {
    if (!this.browser || !this.browser.isConnected()) {
      logger.info('Browser is not connected, reinitializing...');
      try {
        await this.initializeBrowser();
        return true;
      } catch (error) {
        logger.error('Failed to reinitialize browser:', error);
        return false;
      }
    }
    
    // Simpler approach to check pool health
    try {
      // @ts-ignore - access private property only to check state
      const isDraining = this.contextPool && this.contextPool._draining;
      
      if (isDraining) {
        logger.info('Context pool was draining, resetting pool...');
        await this.resetContextPool();
      }
      
      return true;
    } catch (error) {
      logger.error('Error checking pool health:', error);
      return true; // Continue anyway
    }
  }

  private async scheduleBackgroundBrowserRestart(): Promise<void> {
    // Only schedule restart if we're not already shutting down
    if (this.isShuttingDown) return;
    
    setTimeout(async () => {
      try {
        logger.info('Performing scheduled browser restart for memory optimization...');
        
        // Initialize a new browser before closing the old one to minimize downtime
        const oldBrowser = this.browser;
        
        // Create new browser instance
        await this.initializeBrowser();
        
        // Close old browser if it exists
        if (oldBrowser && oldBrowser.isConnected()) {
          try {
            await oldBrowser.close();
          } catch (error) {
            logger.error('Error closing old browser during restart:', error);
          }
        }
        
        logger.info('Scheduled browser restart completed successfully');
      } catch (error) {
        logger.error('Scheduled browser restart failed:', error);
      }
    }, 10000); // Wait 10 seconds before restart to let current requests finish
  }

  /**
   * Returns the current status of the browser manager
   */
  public async getBrowserStatus(): Promise<any> {
    const metrics = await this.getMetrics();
    return {
      initialized: this.isInitialized,
      totalContexts: this.MIN_CONTEXTS,
      activeContexts: this.activeRequests,
      totalPages: metrics.totalPages,
      activeBrowsers: this.browser ? 1 : 0,
      restartsSinceInit: this.totalPagesProcessed / this.BROWSER_RESTART_THRESHOLD
    };
  }

  /**
   * Returns browser metrics for monitoring
   */
  public async getBrowserMetrics(): Promise<BrowserMetrics> {
    return await this.getMetrics();
  }

  // Add a restart method
  async restart() {
    logger.info('Restarting browser instance to free resources');
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    await this.initializeAsync(); // Re-initialize the browser
  }

  // Add a public accessor for browser to use in metrics
  public getBrowser(): Browser | null {
    return this.browser;
  }

  /**
   * Properly clean up a page and manage its context
   */
  async cleanupPage(page: Page): Promise<void> {
    if (!page || page.isClosed()) return;
    
    try {
      const context = page.context();
      
      // Simplified page cleanup - only clear essential storages
      // Skip complex event listener cleanup to improve performance
      try {
        // Use a much shorter and simpler cleanup script
        await page.evaluate(() => {
          try { localStorage?.clear?.(); } catch (e) {}
          try { sessionStorage?.clear?.(); } catch (e) {}
          return true;
        }).catch(() => {});
      } catch (e) {
        // Ignore eval errors, continue with cleanup
      }
      
      // Close the page
      await page.close().catch(() => {});
      
      // More efficient context management
      if (context) {
        // Update pages counter with a simpler approach
        const currentCount = this.pagesPerContext.get(context) || 0;
        if (currentCount > 0) {
          this.pagesPerContext.set(context, currentCount - 1);
        }
        
        // Only check for context cleanup occasionally to reduce overhead
        // This means some empty contexts might stay around longer, but performance will be better
        if (currentCount <= 1 && Math.random() < 0.3) { // Only 30% chance to check for cleanup
          try {
            const pages = await context.pages();
            if (pages.length === 0) {
              const availableContexts = await this.getAvailableContextsCount();
              
              if (availableContexts > this.MIN_CONTEXTS) {
                await context.close().catch(() => {});
                this.pagesPerContext.delete(context);
              }
            }
          } catch (e) {
            // Ignore errors in context management
          }
        }
      }
    } catch (error) {
      // Ignore errors in cleanup to prevent cascading failures
    }
  }

  /**
   * Get the number of available browser contexts
   */
  private async getAvailableContextsCount(): Promise<number> {
    if (!this.browser) return 0;
    
    try {
      const contexts = await this.browser.contexts();
      return contexts.length;
    } catch (e) {
      return 0;
    }
  }

  /**
   * Release unused contexts to free memory - optimized for performance
   */
  async releaseUnusedContexts(): Promise<number> {
    if (!this.browser) return 0;
    
    let closedCount = 0;
    try {
      // Lower the memory threshold for cleanup
      const memUsage = process.memoryUsage();
      const memUsageMB = Math.round(memUsage.rss / (1024 * 1024));
      
      // Perform context cleanup more frequently (400MB instead of 1000MB)
      if (memUsageMB < 400) {
        return 0;
      }
      
      const contexts = await this.browser.contexts();
      
      // Be more aggressive with context cleanup
      // Lower threshold for determining contexts to keep
      const minContextsToKeep = Math.max(
        this.MIN_CONTEXTS,
        memUsageMB > 1000 ? 2 : 3 // Keep fewer contexts overall
      );
      
      // Skip if we don't have enough contexts to warrant cleanup
      if (contexts.length <= minContextsToKeep) {
        return 0;
      }
      
      // Only perform deep page counting if memory is very high
      // Otherwise use a simple approach for better performance
      if (memUsageMB > 1500) {
        // First pass: close contexts with no pages (quick check)
        for (let i = 0; i < contexts.length && closedCount < 2; i++) {
          try {
            const context = contexts[i];
            const pageCount = this.pagesPerContext.get(context) || 0;
            
            if (pageCount === 0) {
              // Quick check if context actually has pages
              try {
                const pages = await context.pages();
                if (pages.length === 0) {
                  await context.close().catch(() => {});
                  this.pagesPerContext.delete(context);
                  closedCount++;
                  
                  // Only close up to 2 contexts at a time to minimize impact
                  if (closedCount >= 2) break;
                }
              } catch (e) {
                // Skip this context if we hit an error
              }
            }
          } catch (e) {
            // Skip problematic contexts
          }
        }
      }
      
      // If memory is extremely high, be more aggressive with context cleanup
      if (closedCount === 0 && memUsageMB > 2000) {
        // Close up to one context even if it has pages
        const contextsWithPageCount = [];
        
        // Get contexts with lowest page counts (fast scan)
        for (const context of contexts) {
          try {
            const pageCount = this.pagesPerContext.get(context) || 0;
            if (pageCount <= 1) {
              contextsWithPageCount.push({ context, pageCount });
              // Once we find one context with 0-1 pages, that's enough
              if (pageCount === 0) break;
            }
          } catch (e) {
            // Skip problematic contexts
          }
        }
        
        // Sort and close the context with the fewest pages
        if (contextsWithPageCount.length > 0) {
          contextsWithPageCount.sort((a, b) => a.pageCount - b.pageCount);
          const contextToClose = contextsWithPageCount[0].context;
          
          try {
            // Close all pages in this context
            const pages = await contextToClose.pages();
            for (const page of pages) {
              await page.close().catch(() => {});
            }
            
            // Close the context
            await contextToClose.close().catch(() => {});
            this.pagesPerContext.delete(contextToClose);
            closedCount++;
          } catch (e) {
            // Ignore errors
          }
        }
      }
      
      // Only force GC if we actually closed some contexts
      if (closedCount > 0 && global.gc) {
        global.gc();
      }
      
      return closedCount;
    } catch (error) {
      return 0; // Return 0 on error to indicate no contexts closed
    }
  }

  /**
   * Force aggressive cleanup of all resources and optionally restart browser
   */
  async forceCleanupAndRestart(): Promise<void> {
    logger.info('Forced cleanup and browser restart initiated');
    
    try {
      // First release all unused contexts
      await this.releaseUnusedContexts();
      
      // Get current memory usage
      const memInfo = process.memoryUsage();
      const memUsageMB = Math.round(memInfo.rss / (1024 * 1024));
      
      logger.info(`Memory usage before forced cleanup: ${memUsageMB}MB`);
      
      // Close and restart browser
      const oldBrowser = this.browser;
      
      // Initialize a new browser instance
      await this.initializeBrowser();
      
      // Close old browser
      if (oldBrowser) {
        try {
          await oldBrowser.close().catch(() => {});
        } catch (e) {
          logger.error('Error closing old browser:', e);
        }
      }
      
      // Recreate context pool
      await this.resetContextPool();
      
      // Force garbage collection
      if (global.gc) {
        global.gc();
        
        // Check memory after cleanup
        const newMemInfo = process.memoryUsage();
        const newMemUsageMB = Math.round(newMemInfo.rss / (1024 * 1024));
        
        logger.info(`Memory usage after forced cleanup: ${newMemUsageMB}MB (freed ${memUsageMB - newMemUsageMB}MB)`);
      }
    } catch (error) {
      logger.error('Error during forced cleanup:', error);
    }
  }

  // Add this method
  private async periodicCleanup() {
    const memInfo = process.memoryUsage();
    const memUsageMB = Math.round(memInfo.rss / (1024 * 1024));
    
    // Even if memory is moderately high during idle time, do cleanup
    if (memUsageMB > 300 && this.activeRequests === 0) {
      logger.info(`Periodic cleanup: Memory at ${memUsageMB}MB during idle time`);
      await this.releaseUnusedContexts();
      
      // If still high after releasing contexts, consider more aggressive cleanup
      const newMemInfo = process.memoryUsage();
      const newMemUsageMB = Math.round(newMemInfo.rss / (1024 * 1024));
      
      if (newMemUsageMB > 400) {
        logger.info(`Memory still high at ${newMemUsageMB}MB, performing aggressive cleanup`);
        await this.forceCleanupAndRestart();
      }
    }
  }
}

export const browserManager = new BrowserManager(); 