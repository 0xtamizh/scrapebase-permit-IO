// import axios from 'axios';
// import cheerio from 'cheerio';

// async function testAxiosScrape(url: string, retries: number = 3): Promise<void> {
//   for (let attempt = 1; attempt <= retries; attempt++) {
//     try {
//       console.log(`Testing Axios scrape for URL: ${url} (Attempt ${attempt}/${retries})`);

//       // Log request details
//       console.log('Making GET request with headers:', {
//         'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
//         'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
//         'Accept-Language': 'en-US,en;q=0.5',
//         'Cache-Control': 'no-cache',
//         'Pragma': 'no-cache',
//         'Upgrade-Insecure-Requests': '1',
//         'Referer': 'https://www.google.com/', // Add a referer header
//         'Connection': 'keep-alive', // Keep the connection alive
//       });

//       // Make a GET request to the URL
//       const response = await axios.get(url, {
//         headers: {
//           'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
//           'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
//           'Accept-Language': 'en-US,en;q=0.5',
//           'Cache-Control': 'no-cache',
//           'Pragma': 'no-cache',
//           'Upgrade-Insecure-Requests': '1',
//           'Referer': 'https://www.google.com/',
//           'Connection': 'keep-alive',
//         },
//         timeout: 10000, // 10-second timeout
//         maxRedirects: 0, // Disable automatic redirects
//       });

//       // Log response details
//       console.log('Response received:', {
//         status: response.status,
//         statusText: response.statusText,
//         headers: response.headers,
//         dataLength: response.data.length,
//       });

//       // Check if the response is successful
//       if (response.status !== 200) {
//         throw new Error(`Request failed with status code: ${response.status}`);
//       }

//       // Load the HTML into Cheerio
//       const $ = cheerio.load(response.data);

//       // Extract and log the page title
//       const title = $('title').text();
//       console.log(`Page Title: ${title}`);

//       // Extract and log the first paragraph of content
//       const firstParagraph = $('p').first().text();
//       console.log(`First Paragraph: ${firstParagraph}`);

//       console.log('Axios scrape test completed successfully.');
//       return;
//     } catch (error) {
//       console.error(`Attempt ${attempt} failed:`, {
//         message: error instanceof Error ? error.message : String(error),
//         stack: error instanceof Error ? error.stack : undefined,
//         isAxiosError: axios.isAxiosError(error),
//         response: axios.isAxiosError(error) ? {
//           status: error.response?.status,
//           statusText: error.response?.statusText,
//           headers: error.response?.headers,
//           data: error.response?.data,
//         } : undefined,
//       });

//       // Add a random delay between retries
//       if (attempt < retries) {
//         const delay = 3000 + Math.random() * 5000; // Random delay between 3-8 seconds
//         console.log(`Retrying in ${Math.round(delay / 1000)} seconds...`);
//         await new Promise(resolve => setTimeout(resolve, delay));
//       }
//     }
//   }

//   console.error('All retry attempts failed.');
// }

// // Self-running function to test the Axios scrape
// (async () => {
//   const url = 'https://www.marktechpost.com/'; // Replace with the URL you want to test
//   await testAxiosScrape(url);
// })(); 




// import { chromium, Browser, BrowserContext, Page, type Route } from 'playwright';

// import genericPool from 'generic-pool';
// import EventEmitter from 'events';
// import os from 'os';
// import { exec } from 'child_process';
// import { promisify } from 'util';
// import winston from 'winston';

// // Use inline definition instead of import
// const execAsync = promisify(exec);

// // Create a logger
// const logger = winston.createLogger({
//   level: 'debug',
//   format: winston.format.combine(
//     winston.format.timestamp(),
//     winston.format.json()
//   ),
//   defaultMeta: { service: 'browser-manager' },
//   transports: [
//     new winston.transports.Console({
//       format: winston.format.combine(
//         winston.format.colorize(),
//         winston.format.printf(({ level, message, timestamp }) => {
//           // Truncate long messages to prevent console flooding
//           let displayMessage = message;
//           if (typeof message === 'string' && message.length > 500) {
//             displayMessage = message.substring(0, 500) + '... [truncated]';
//           }
//           return `${timestamp} ${level}: ${displayMessage}`;
//         })
//       )
//     })
//   ]
// });

// interface BrowserMetrics {
//   activeRequests: number;
//   availableContexts: number;
//   totalContexts: number;
//   cpuUsage: number;
//   memoryUsage: {
//     total: number;
//     free: number;
//     processUsed: number;
//   };
//   totalPages: number;
//   maxPagesInContext: number;
//   avgPagesPerContext: number;
//   totalPagesProcessed: number;
// }

// /**
//  * Filter content to prevent logging HTML/CSS content
//  */
// function filterLoggableContent(content: any): any {
//   if (typeof content !== 'string') {
//     return content;
//   }
  
//   // Check for OneTrust specific content
//   if (content.includes('#onetrust-') || 
//       content.includes('.ot-sdk-') || 
//       content.includes('cookielaw.org') ||
//       content.includes('OneTrust') ||
//       content.includes('ot-floating-button')) {
//     return `[OneTrust content, ${content.length} bytes]`;
//   }
  
//   // Check if content is HTML/CSS
//   if (content.includes('<html') || 
//       content.includes('<body') || 
//       content.includes('<style') || 
//       content.includes('#onetrust') ||
//       content.includes('color:') || 
//       content.includes('background-color:')) {
//     return `[HTML/CSS content, ${content.length} bytes]`;
//   }
  
//   // Truncate long text
//   if (content.length > 500) {
//     return content.substring(0, 500) + '... [truncated]';
//   }
  
//   return content;
// }

// // Update your domain comparison logic to handle www/non-www variants


// class BrowserManager extends EventEmitter {
//   private browser: Browser | null = null;
//   private contextPool!: genericPool.Pool<BrowserContext>;
//   private activeRequests: number = 0;
//   private isShuttingDown: boolean = false;
//   private metricsInterval: NodeJS.Timeout | null = null;
//   public isInitialized: boolean = false;
  
//   // Track pages per context
//   private pagesPerContext: Map<BrowserContext, number> = new Map();
  
//   // Optimized timeouts and limits - updated based on requirements
//   private readonly MAX_CONTEXTS = 20;  // Increased to 20
//   private readonly MIN_CONTEXTS = 2;   // Increased to 2
//   private readonly MAX_PAGES_PER_CONTEXT = 10; // Increased to 10 for better efficiency
//   private readonly METRICS_INTERVAL = 10000;
//   private readonly PAGE_TIMEOUT = 30000;
//   private readonly NAVIGATION_TIMEOUT = 30000;
//   private readonly CONTEXT_TIMEOUT = 30000;
//   private readonly BROWSER_RESTART_THRESHOLD = 1000; // Restart browser after 1000 pages
//   private totalPagesProcessed: number = 0;

//   public pagePool!: genericPool.Pool<Page>;

//   constructor() {
//     super();
//     this.initializeAsync();
//   }

//   private async initializeAsync() {
//     const maxRetries = 3;
//     let retryCount = 0;
    
//     while (retryCount < maxRetries) {
//       try {
//         logger.info(`Starting Browser Manager initialization (attempt ${retryCount + 1}/${maxRetries})...`);
        
//         // First initialize the browser
//         await this.initializeBrowser();
//         logger.info('Browser initialized successfully');
        
//         // Create and configure the context pool
//         this.contextPool = this.createContextPool();
//         logger.info('Context pool created');
        
//         // Start metrics monitoring
//         this.initializeMetricsMonitoring();
//         this.setupEventListeners();
//         logger.info('Monitoring initialized');
        
//         // Start the pool
//         await this.contextPool.start();
//         logger.info('Pool started');
        
//         // Initialize first context with timeout
//         let initialContextSuccess = false;
        
//         try {
//           logger.info('Creating initial test context...');
//           const context = await Promise.race([
//             this.contextPool.acquire(),
//             new Promise<never>((_, reject) => 
//               setTimeout(() => reject(new Error('Initial context creation timeout')), 15000)
//             )
//           ]);
          
//           if (context) {
//             // Test the context
//             const testPage = await context.newPage();
//             await testPage.close();
            
//             // Release it back
//             await this.contextPool.release(context);
//             initialContextSuccess = true;
//             logger.info('Initial context created and tested successfully');
//           }
//         } catch (error) {
//           logger.error('Error creating initial test context:', error);
//           // Continue anyway - the pool can create contexts on demand
//         }
        
//         this.isInitialized = true;
//         logger.info('Browser Manager initialization complete');
        
//         // Only create page pool if context pool is working
//         if (initialContextSuccess) {
//           // Create a pool of pages from this browser instance
//           this.pagePool = genericPool.createPool({
//             create: async () => {
//               // Check if browser is initialized
//               if (!this.browser) {
//                 throw new Error('Browser not initialized');
//               }
//               // Create a new browser context for isolation and its page
//               const context = await this.browser.newContext();
//               const page = await context.newPage();
//               await this.setupPageRouting(page);
//               return page;
//             },
//             destroy: async (page: Page) => {
//               // Close the page and its context on destroy
//               const context = page.context();
//               try { await page.close(); } catch (e) { }
//               try { await context.close(); } catch (e) { }
//             }
//           }, { min: 1, max: 10 }); // Tune these values as needed
//         }
        
//         // Successful initialization
//         return;
//       } catch (error) {
//         retryCount++;
//         logger.error(`Browser Manager initialization failed (attempt ${retryCount}/${maxRetries}):`, error);
        
//         // Clean up failed attempts
//         if (this.contextPool) {
//           try {
//             this.contextPool.drain().catch(e => logger.error('Error draining pool during retry:', e));
//           } catch (e) {
//             // Ignore
//           }
//         }
        
//         if (this.browser) {
//           try {
//             await this.browser.close().catch(() => {});
//             this.browser = null;
//           } catch (e) {
//             // Ignore
//           }
//         }
        
//         // Only retry if we haven't reached max retries
//         if (retryCount >= maxRetries) {
//           this.isInitialized = false;
//           logger.error('Browser Manager initialization failed after maximum retry attempts');
//           throw error;
//         }
        
//         // Wait before retry
//         const delayMs = 2000 * retryCount;
//         logger.info(`Waiting ${delayMs}ms before retry...`);
//         await new Promise(resolve => setTimeout(resolve, delayMs));
//       }
//     }
//   }

//   private createContextPool(): genericPool.Pool<BrowserContext> {
//     return genericPool.createPool<BrowserContext>({
//       create: async () => {
//         if (!await this.checkBrowserHealth()) {
//           throw new Error('Browser is not healthy');
//         }

//         if (!this.browser) throw new Error('Browser not initialized');
        
//         // Create new context
//         const context = await this.browser.newContext({
//           viewport: { width: 1280, height: 720 },
//           userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
//           bypassCSP: true,
//           ignoreHTTPSErrors: true,
//           offline: false,
//           javaScriptEnabled: true
//         });
        
//         // Set timeouts
//         await context.setDefaultTimeout(this.PAGE_TIMEOUT);
//         await context.setDefaultNavigationTimeout(this.NAVIGATION_TIMEOUT);
        
//         return context;
//       },
//       destroy: async (context: BrowserContext) => {
//         try {
//           await context.close().catch(() => {});
//         } catch (error) {
//           logger.error('Error closing context during destroy:', error);
//         }
//       },
//       validate: async (context: BrowserContext): Promise<boolean> => {
//         try {
//           // Simpler validation - just check if it exists and has the expected methods
//           return !!context && typeof context.newPage === 'function';
//         } catch (error) {
//           return false;
//         }
//       }
//     }, {
//       max: this.MAX_CONTEXTS,
//       min: this.MIN_CONTEXTS,
//       acquireTimeoutMillis: 30000, // Increase timeout to 30 seconds
//       evictionRunIntervalMillis: 30000, // Run eviction less frequently
//       numTestsPerEvictionRun: 2,
//       softIdleTimeoutMillis: 30000, // Longer idle timeout
//       idleTimeoutMillis: 60000, // Longer idle timeout
//       testOnBorrow: true,
//       autostart: false
//     });
//   }

//   private async initializeBrowser(): Promise<void> {
//     if (this.browser) {
//       try {
//         await this.browser.close();
//       } catch (error) {
//         logger.error('Error closing existing browser:', error);
//       }
//     }

//     try {
//       logger.info('Launching Playwright Chromium browser...');
      
//       this.browser = await chromium.launch({
//         headless: true,
//         executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser',
//         args: [
//           '--no-sandbox',
//           '--disable-setuid-sandbox',
//           '--disable-dev-shm-usage',
//           '--disable-gpu',
//           '--disable-extensions',
//           '--disable-background-networking',
//           '--disable-background-timer-throttling',
//           '--disable-backgrounding-occluded-windows',
//           '--disable-breakpad',
//           '--disable-component-extensions-with-background-pages',
//           '--disable-features=TranslateUI,BlinkGenPropertyTrees',
//           '--disable-ipc-flooding-protection',
//           '--disable-renderer-backgrounding',
//         ],
//         ignoreDefaultArgs: ['--enable-automation'],
//       });

//       if (!this.browser) {
//         throw new Error('Failed to launch Playwright Chromium browser');
//       }

//       // Test browser is working
//       const testContext = await this.browser.newContext();
//       const testPage = await testContext.newPage();
//       await testContext.close();

//       logger.info('Playwright Chromium browser initialized successfully');
      
//       this.browser.on('disconnected', this.handleBrowserDisconnect.bind(this));
      
//       // Reset the counter for pages processed
//       this.totalPagesProcessed = 0;
//     } catch (error) {
//       logger.error('Failed to initialize Playwright browser:', error);
//       throw error;
//     }
//   }

//   private handleBrowserDisconnect(): void {
//     logger.error('Browser disconnected unexpectedly!');
//     this.emit('browser-disconnected');
    
//     // Trigger browser reinitialization
//     setTimeout(async () => {
//       logger.info('Attempting to recover browser after disconnection...');
//       try {
//         await this.initializeBrowser();
//         logger.info('Browser recovered successfully after disconnection');
//       } catch (error) {
//         logger.error('Failed to recover browser after disconnection:', error);
//       }
//     }, 1000);
//   }

//   private setupEventListeners(): void {
//     this.on('error', (error: Error) => {
//       logger.error('BrowserManager error:', error);
//     });

//     process.on('SIGTERM', this.shutdown.bind(this));
//     process.on('SIGINT', this.shutdown.bind(this));
//   }

//   private initializeMetricsMonitoring(): void {
//     this.metricsInterval = setInterval(async () => {
//       try {
//         const metrics = await this.getMetrics();
//         // Don't log metrics unless in debug mode
//         if (process.env.LOG_LEVEL === 'debug') {
//           this.logFormattedMetrics(metrics);
//         }
//         await this.autoScale(metrics);
        
//         // Force garbage collection if memory usage is high - 
//         // Lowered from 500MB to 200MB for more frequent cleanup
//         if (metrics.memoryUsage.processUsed > 200 * 1024 * 1024) {
//           global.gc?.();
//         }
//       } catch (error) {
//         logger.error('Error collecting metrics:', error);
//       }
//     }, this.METRICS_INTERVAL);
//   }

//   private logFormattedMetrics(metrics: BrowserMetrics): void {
   
    
//     const formatBytes = (bytes: number): string => {
//       const units = ['B', 'KB', 'MB', 'GB'];
//       let size = bytes;
//       let unitIndex = 0;
//       while (size >= 1024 && unitIndex < units.length - 1) {
//         size /= 1024;
//         unitIndex++;
//       }
//       return `${size.toFixed(2)} ${units[unitIndex]}`;
//     };

//     logger.debug('\n=== Browser Manager Status ===');
//     logger.debug(`Time: ${new Date().toLocaleTimeString()}`);
//     logger.debug('\nRequest Status:');
//     logger.debug(`• Active Requests: ${metrics.activeRequests}`);
//     logger.debug(`• Browser Contexts: ${metrics.totalContexts} (${metrics.availableContexts} available)`);
//     logger.debug(`• Pages: Total: ${metrics.totalPages}, Max per context: ${metrics.maxPagesInContext.toFixed(2)}, Avg per context: ${metrics.avgPagesPerContext.toFixed(2)}`);
    
//     logger.debug('\nSystem Resources:');
//     logger.debug(`• CPU Usage: ${(metrics.cpuUsage * 100).toFixed(2)}%`);
//     logger.debug(`• Memory: ${formatBytes(metrics.memoryUsage.processUsed)} / ${formatBytes(metrics.memoryUsage.total)} (${formatBytes(metrics.memoryUsage.free)} free)`);
//     logger.debug('===========================\n');
//   }

//   public async getMetrics(): Promise<BrowserMetrics> {
//     if (!this.browser) {
//       // Return default metrics instead of null
//       return {
//         activeRequests: this.activeRequests,
//         availableContexts: this.MAX_CONTEXTS - this.activeRequests,
//         totalContexts: this.MAX_CONTEXTS,
//         cpuUsage: 0,
//         memoryUsage: {
//           total: os.totalmem(),
//           free: os.freemem(),
//           processUsed: 0
//         },
//         totalPages: 0,
//         maxPagesInContext: 0,
//         avgPagesPerContext: 0,
//         totalPagesProcessed: this.totalPagesProcessed
//       };
//     }
    
//     try {
//       // Get all browser contexts
//       const contexts = await this.browser.contexts();
      
//       // Calculate total pages
//       const pagesPerContext = await Promise.all(
//         contexts.map(async ctx => (await ctx.pages()).length)
//       );
      
//       const totalPages = pagesPerContext.reduce((sum, count) => sum + count, 0);
//       const maxPagesInContext = Math.max(0, ...pagesPerContext);
//       const avgPagesPerContext = contexts.length > 0 
//         ? parseFloat((totalPages / contexts.length).toFixed(2)) 
//         : 0;
      
//       // Get browser process information
//       let cpuUsage = 0;
//       let memoryUsage = {
//         total: os.totalmem(),
//         free: os.freemem(),
//         processUsed: 0
//       };
      
//       // Use a safer approach to get browser process information
//       try {
//         // Get process information based on platform
//         if (process.platform === 'linux' || process.platform === 'darwin') {
//           // For Linux/macOS, use ps command to get browser process info
//           // First get all chrome/chromium processes
//           const { stdout: processListOutput } = await execAsync('ps -ef | grep -i chrome');
          
//           // Parse process list to find browser processes
//           const processLines = processListOutput.split('\n');
//           let browserPids: number[] = [];
          
//           // Look for chromium/chrome processes (excluding grep itself)
//           for (const line of processLines) {
//             if (line.includes('chromium') || line.includes('chrome')) {
//               // Skip grep process
//               if (line.includes('grep -i chrome')) continue;
              
//               // Extract PID (usually the 2nd column in ps output)
//               const parts = line.trim().split(/\s+/);
//               if (parts.length >= 2) {
//                 const pid = parseInt(parts[1]);
//                 if (!isNaN(pid)) {
//                   browserPids.push(pid);
//                 }
//               }
//             }
//           }
          
//           // If we found browser processes, check their CPU usage
//           if (browserPids.length > 0) {
//             // Get CPU usage for the first browser process found
//             const pidToCheck = browserPids[0];
//             const { stdout } = await execAsync(`ps -p ${pidToCheck} -o %cpu,%mem`);
//             const lines = stdout.trim().split('\n');
//             if (lines.length > 1) {
//               const values = lines[1].trim().split(/\s+/);
//               cpuUsage = parseFloat(values[0]) / 100; // Convert percentage to decimal
              
//               // Also get memory usage if available
//               if (values.length > 1) {
//                 // Calculate memory usage based on percentage of total
//                 const memPercent = parseFloat(values[1]) / 100;
//                 memoryUsage.processUsed = Math.round(memoryUsage.total * memPercent);
//               }
//             }
//           }
//         } 
//         else if (process.platform === 'win32') {
//           // For Windows, use wmic (note: this is deprecated in newer Windows versions)
//           try {
//             // Try to find chrome processes
//             const { stdout: processList } = await execAsync('wmic process where "name like \'%chrome%\'" get processid,workingsetsize');
//             const lines = processList.trim().split('\n');
            
//             if (lines.length > 1) {
//               // Skip header line and process first chrome process found
//               const parts = lines[1].trim().split(/\s+/);
//               if (parts.length >= 2) {
//                 // Last part should be the PID, before that is memory
//                 const pid = parts[parts.length - 1];
//                 const memory = parts[parts.length - 2];
                
//                 // Set memory usage
//                 memoryUsage.processUsed = parseInt(memory);
                
//                 // Get CPU usage with another command
//                 const { stdout: cpuData } = await execAsync(`wmic process where processid=${pid} get cpuusage`);
//                 const cpuLines = cpuData.trim().split('\n');
//                 if (cpuLines.length > 1) {
//                   cpuUsage = parseInt(cpuLines[1].trim()) / 100;
//                 }
//               }
//             }
//           } catch (e) {
//             // Fallback to process.memoryUsage for some estimate
//             const processMemInfo = process.memoryUsage();
//             memoryUsage.processUsed = processMemInfo.rss;
//           }
//         }
        
//         // If we still don't have process memory, use Node's memory as approximation
//         if (!memoryUsage.processUsed) {
//           const processMemInfo = process.memoryUsage();
//           memoryUsage.processUsed = processMemInfo.rss;
//         }
//       } catch (e) {
//         logger.error('Error getting browser process metrics:', e);
//         // Fallback to process.memoryUsage if all else fails
//         const processMemInfo = process.memoryUsage();
//         memoryUsage.processUsed = processMemInfo.rss;
//       }
      
//       return {
//         activeRequests: this.activeRequests,
//         availableContexts: this.MAX_CONTEXTS - this.activeRequests,
//         totalContexts: this.MAX_CONTEXTS,
//         cpuUsage,
//         memoryUsage,
//         totalPages,
//         maxPagesInContext,
//         avgPagesPerContext,
//         totalPagesProcessed: this.totalPagesProcessed
//       };
//     } catch (e) {
//       logger.error('Error getting browser metrics:', e);
//       // Return default metrics instead of error object
//       return {
//         activeRequests: this.activeRequests,
//         availableContexts: this.MAX_CONTEXTS - this.activeRequests,
//         totalContexts: this.MAX_CONTEXTS,
//         cpuUsage: 0,
//         memoryUsage: {
//           total: os.totalmem(),
//           free: os.freemem(),
//           processUsed: 0
//         },
//         totalPages: 0,
//         maxPagesInContext: 0,
//         avgPagesPerContext: 0,
//         totalPagesProcessed: this.totalPagesProcessed
//       };
//     }
//   }

//   private async autoScale(metrics: BrowserMetrics): Promise<void> {
//     const requestsPerContext = metrics.activeRequests / metrics.totalContexts;
    
//     // Only create new contexts if we're really under pressure (multiple requests per context)
//     if (requestsPerContext > this.MAX_PAGES_PER_CONTEXT && metrics.totalContexts < this.MAX_CONTEXTS) {
//       await this.contextPool.start();
//     }
    
//     // REMOVED the drain/clear logic that was causing "pool is draining" errors
//     // Never drain the main pool during normal operation - this breaks subsequent requests
    
//     // Optional: If you need to manage pool size, just use destroy on individual contexts
//     // rather than draining the whole pool
//   }

//   // Get the context with the fewest active pages
//   private async getLeastBusyContext(): Promise<BrowserContext> {
//     try {
//       // Check if pool is draining and reset if needed
//       await this.ensurePoolIsNotDraining();
      
//       // Add retry logic for acquiring context
//       let attempts = 0;
//       const maxAttempts = 3;
      
//       while (attempts < maxAttempts) {
//         try {
//           return await this.contextPool.acquire();
//         } catch (error) {
//           attempts++;
//           // If we got a "pool is draining" error, try to reset the pool
//           if (error instanceof Error && error.message.includes('pool is draining')) {
//             logger.info('Pool is draining, attempting to reset...');
//             await this.ensurePoolIsNotDraining();
//           }
          
//           if (attempts === maxAttempts) throw error;
//           await new Promise(resolve => setTimeout(resolve, 1000));
//         }
//       }
      
//       throw new Error('Failed to acquire context after retries');
//     } catch (error) {
//       logger.error('Error finding least busy context:', error);
//       // If we still can't get a context, reinitialize the pool
//       if (error instanceof Error && error.message.includes('pool is draining')) {
//         await this.resetContextPool();
//       }
//       // Try one more time with direct acquire
//       return await this.contextPool.acquire();
//     }
//   }

//   // Ensure the pool is not in a draining state
//   private async ensurePoolIsNotDraining(): Promise<void> {
//     try {
//       // Use private property access to check if pool is draining
//       // @ts-ignore - we need to access private property
//       if (this.contextPool._draining) {
//         logger.info('Context pool was in draining state, resetting...');
//         await this.resetContextPool();
//       }
//     } catch (error) {
//       logger.error('Error checking if pool is draining:', error);
//     }
//   }

//   // Reset context pool if needed
//   private async resetContextPool(): Promise<void> {
//     try {
//       logger.info('Resetting context pool...');
      
//       // Try to clear old pool if possible
//       try {
//         if (this.contextPool) {
//           // Drain without waiting - just mark for draining
//           this.contextPool.drain().catch(e => logger.error('Error draining old pool:', e));
//         }
//       } catch (e) {
//         logger.error('Error preparing old pool for reset:', e);
//       }
      
//       // Create a new pool
//       this.contextPool = this.createContextPool();
      
//       // Start the pool
//       await this.contextPool.start();
//       logger.info('New context pool created and started');
      
//       // Create initial contexts one by one with proper error handling
//       logger.info(`Creating ${this.MIN_CONTEXTS} initial contexts...`);
//       let successCount = 0;
      
//       for (let i = 0; i < this.MIN_CONTEXTS; i++) {
//         try {
//           // Use a timeout to prevent hanging
//           const context = await Promise.race([
//             this.contextPool.acquire(),
//             new Promise<never>((_, reject) => 
//               setTimeout(() => reject(new Error('Context creation timeout')), 10000)
//             )
//           ]);
          
//           if (context) {
//             // Successfully acquired a context, now release it back
//             await this.contextPool.release(context);
//             successCount++;
//             logger.info(`Created initial context ${successCount}/${this.MIN_CONTEXTS}`);
//           }
//         } catch (error) {
//           logger.error(`Failed to create initial context ${i+1}/${this.MIN_CONTEXTS}:`, error);
//         }
//       }
      
//       logger.info(`Context pool reset complete (created ${successCount}/${this.MIN_CONTEXTS} contexts)`);
//     } catch (error) {
//       logger.error('Failed to reset context pool:', error);
//     }
//   }

//   async withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
//     // Track this request
//     this.activeRequests++;
    
//     // For tracking execution time
//     const startTime = Date.now();
    
//     let context: BrowserContext | null = null;
//     let page: Page | null = null;
//     let reusingPage = false; // Boolean to track if we're reusing a page from the pool
    
//     try {
//       // Make sure the pool isn't being drained
//       await this.ensurePoolIsNotDraining();
      
//       // Try to reuse existing page from pool if available
//       try {
//         if (this.pagePool && Math.random() > 0.2) { // 80% chance to try page reuse
//           // Try to get a page from the pool with a short timeout
//           const pooledPage = await Promise.race([
//             this.pagePool.acquire(),
//             new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Page pool timeout')), 500))
//           ]);
          
//           if (pooledPage) {
//             page = pooledPage;
//             reusingPage = true;
            
//             // Clear and reset the page with error handling
//             try {
//               await Promise.all([
//                 page.evaluate(() => {
//                   try {
//                     localStorage.clear();
//                   } catch (e) {
//                     // Ignore localStorage errors
//                   }
//                   try {
//                     sessionStorage.clear();
//                   } catch (e) {
//                     // Ignore sessionStorage errors
//                   }
//                   window.scrollTo(0, 0);
//                   return true;
//                 })
//               ]);
              
//               // Reset cookies and cache (but only do this occasionally to save time)
//               if (Math.random() > 0.7) { // 30% chance to clear cookies
//                 await page.context().clearCookies();
//               }
//             } catch (e) {
//               logger.debug(`Error resetting page: ${e}`);
//               // Continue anyway - this isn't critical
//             }
//           }
//         }
//       } catch (e) {
//         // If page pool access fails, we'll create a page the normal way
//         logger.debug(`Page pool access failed: ${e}`);
//       }
      
//       // If we couldn't get a page from the pool, create a new one
//       if (!page) {
//         // Get a browser context from the pool
//         context = await this.getLeastBusyContext();
        
//         if (!context) {
//           throw new Error('Failed to acquire browser context');
//         }
        
//         logger.debug('Creating new page...');
        
//         // Create a page with timeout safeguard
//         page = await Promise.race([
//           context.newPage(),
//           new Promise<never>((_, reject) => 
//             setTimeout(() => reject(new Error('Page creation timeout')), this.PAGE_TIMEOUT)
//           )
//         ]);
        
//         // Increment page count for this context
//         this.pagesPerContext.set(context, (this.pagesPerContext.get(context) || 0) + 1);
        
//         // Set up page routing
//         await this.setupPageRouting(page);
//       }
      
//       // Configure page settings
//       await page.setDefaultNavigationTimeout(this.NAVIGATION_TIMEOUT);
//       await page.setDefaultTimeout(this.PAGE_TIMEOUT);
      
//       // Execute the provided function with our page
//       const result = await fn(page);
      
//       // Calculate and log execution time
//       const executionTime = Date.now() - startTime;
//       logger.debug(`Request completed successfully in ${executionTime}ms`);
      
//       // Increment total pages counter
//       this.totalPagesProcessed++;
      
//       // Check if it's time to restart browser to prevent memory issues
//       if (this.totalPagesProcessed >= this.BROWSER_RESTART_THRESHOLD) {
//         logger.info(`Reached ${this.totalPagesProcessed} processed pages, scheduling background browser restart`);
//         this.scheduleBackgroundBrowserRestart();
//       }
      
//       return result;
      
//     } catch (error) {
//       // Log the error
//       logger.error('Error in withPage:', error);
//       throw error;
      
//     } finally {
//       try {
//         // Return page to pool if we were reusing it
//         if (page && reusingPage) {
//           try {
//             await this.pagePool.release(page);
//           } catch (e) {
//             logger.error('Error releasing page to pool:', e);
//             // If we can't release the page, close it
//             await page.close().catch(() => {});
//           }
//         } 
//         // Close the page if we created it
//         else if (page) {
//           await page.close().catch(() => {});
          
//           // Decrement page count for this context
//           if (context) {
//             const count = this.pagesPerContext.get(context) || 0;
//             if (count > 0) {
//               this.pagesPerContext.set(context, count - 1);
//             }
//           }
//         }
        
//         // Release the context back to the pool if we got one
//         if (context) {
//           try {
//             await this.contextPool.release(context);
//           } catch (e) {
//             logger.error('Error releasing context to pool:', e);
//           }
//         }
        
//         // Decrement active requests
//         this.activeRequests--;
        
//       } catch (e) {
//         logger.error('Error in withPage cleanup:', e);
//         this.activeRequests--;
//       }
//     }
//   }

//   private async setupPageRouting(page: Page): Promise<void> {
//     await page.route('**/*', async (route: Route) => {
//       const request = route.request();
//       const resourceType = request.resourceType();
//       const url = request.url();
      
//       // Block OneTrust and cookie-related resources
//       if (url.includes('onetrust') || 
//           url.includes('cookielaw') || 
//           url.includes('cookie-consent') ||
//           url.includes('cookie-policy') ||
//           url.includes('privacy-policy') ||
//           url.includes('gdpr')) {
//         await route.abort();
//         return;
//       }
      
//       // Allow essential resources and main stylesheets
//       if (resourceType === 'document' || 
//           resourceType === 'script' || 
//           resourceType === 'stylesheet' || 
//           resourceType === 'fetch' || 
//           resourceType === 'xhr') {
//         await route.continue();
//       } else if (resourceType === 'image' && url.includes('logo')) {
//         // Allow logo images
//         await route.continue();
//       } else {
//         // Block non-essential resources
//         await route.abort();
//       }
//     });
//   }

//   public async shutdown(): Promise<void> {
//     if (this.isShuttingDown) {
//       logger.info('Shutdown already in progress');
//       return;
//     }
    
//     this.isShuttingDown = true;
//     logger.info('Starting BrowserManager shutdown...');
    
//     if (this.metricsInterval) {
//       clearInterval(this.metricsInterval);
//       this.metricsInterval = null;
//     }
    
//     try {
//       // Clear the page tracking
//       this.pagesPerContext.clear();
      
//       // Drain and clear pools
//       if (this.contextPool) {
//         logger.info('Draining context pool...');
//         await this.contextPool.drain();
//         await this.contextPool.clear();
//       }
      
//       if (this.pagePool) {
//         logger.info('Draining page pool...');
//         await this.pagePool.drain();
//         await this.pagePool.clear();
//       }
      
//       // Close browser
//       if (this.browser) {
//         logger.info('Closing browser...');
//         await this.browser.close();
//         this.browser = null;
//       }
      
//       logger.info('BrowserManager shutdown completed successfully');
//     } catch (error) {
//       logger.error('Error during BrowserManager shutdown:', error);
//       throw error;
//     }
//   }

//   // Add a new method to check browser health
//   private async checkBrowserHealth(): Promise<boolean> {
//     if (!this.browser || !this.browser.isConnected()) {
//       logger.info('Browser is not connected, reinitializing...');
//       try {
//         await this.initializeBrowser();
//         return true;
//       } catch (error) {
//         logger.error('Failed to reinitialize browser:', error);
//         return false;
//       }
//     }
    
//     // Simpler approach to check pool health
//     try {
//       // @ts-ignore - access private property only to check state
//       const isDraining = this.contextPool && this.contextPool._draining;
      
//       if (isDraining) {
//         logger.info('Context pool was draining, resetting pool...');
//         await this.resetContextPool();
//       }
      
//       return true;
//     } catch (error) {
//       logger.error('Error checking pool health:', error);
//       return true; // Continue anyway
//     }
//   }

//   private async scheduleBackgroundBrowserRestart(): Promise<void> {
//     // Only schedule restart if we're not already shutting down
//     if (this.isShuttingDown) return;
    
//     setTimeout(async () => {
//       try {
//         logger.info('Performing scheduled browser restart for memory optimization...');
        
//         // Initialize a new browser before closing the old one to minimize downtime
//         const oldBrowser = this.browser;
        
//         // Create new browser instance
//         await this.initializeBrowser();
        
//         // Close old browser if it exists
//         if (oldBrowser && oldBrowser.isConnected()) {
//           try {
//             await oldBrowser.close();
//           } catch (error) {
//             logger.error('Error closing old browser during restart:', error);
//           }
//         }
        
//         logger.info('Scheduled browser restart completed successfully');
//       } catch (error) {
//         logger.error('Scheduled browser restart failed:', error);
//       }
//     }, 10000); // Wait 10 seconds before restart to let current requests finish
//   }

//   /**
//    * Returns the current status of the browser manager
//    */
//   public async getBrowserStatus(): Promise<any> {
//     const metrics = await this.getMetrics();
//     return {
//       initialized: this.isInitialized,
//       totalContexts: this.MIN_CONTEXTS,
//       activeContexts: this.activeRequests,
//       totalPages: metrics.totalPages,
//       activeBrowsers: this.browser ? 1 : 0,
//       restartsSinceInit: this.totalPagesProcessed / this.BROWSER_RESTART_THRESHOLD
//     };
//   }

//   /**
//    * Returns browser metrics for monitoring
//    */
//   public async getBrowserMetrics(): Promise<BrowserMetrics> {
//     return await this.getMetrics();
//   }

//   // Add a restart method
//   async restart() {
//     logger.info('Restarting browser instance to free resources');
//     if (this.browser) {
//       await this.browser.close();
//       this.browser = null;
//     }
//     await this.initializeAsync(); // Re-initialize the browser
//   }

//   // Add a public accessor for browser to use in metrics
//   public getBrowser(): Browser | null {
//     return this.browser;
//   }
// }

// export const browserManager = new BrowserManager(); 











// -----------




// import { Router, Request, Response, NextFunction } from 'express';
// import { ErrorCode, sendErrorResponse } from '../utils/errorHandler';
// import winston from 'winston';
// import validator from 'validator';
// import { URL } from 'url';
// import pLimit from 'p-limit';
// // Import processLinks router and the processWebsite function
// import { processWithRetry } from '../processLinks';

// // Local implementation of isSameDomain
// function isSameDomain(baseUrl: string, testUrl: string): boolean {
//     const baseHostname = new URL(baseUrl).hostname.replace(/^www\./, '');
//     const testHostname = new URL(testUrl).hostname.replace(/^www\./, '');
//     return baseHostname === testHostname;
// }

// // Create a logger instance
// const logger = winston.createLogger({
//   level: 'debug',
//   format: winston.format.combine(
//     winston.format.timestamp(),
//     winston.format.json()
//   ),
//   defaultMeta: { service: 'scrapebase-website' },
//   transports: [
//     new winston.transports.Console({
//       format: winston.format.combine(
//         winston.format.colorize(),
//         winston.format.printf(({ level, message, timestamp }) => {
//           let displayMessage = message;
//           if (typeof message === 'string' && message.length > 200) {
//             displayMessage = message.substring(0, 200) + '... [truncated]';
//           }
//           return `${timestamp} ${level}: ${displayMessage}`;
//         })
//       )
//     })
//   ]
// });

// const router = Router();

// // Configure concurrency and timeout limits
// const MAX_CONCURRENT_SUBPAGE_REQUESTS = parseInt(process.env.MAX_CONCURRENT_SUBPAGE_REQUESTS || '10', 10);
// const SUBPAGE_REQUEST_TIMEOUT = parseInt(process.env.SUBPAGE_REQUEST_TIMEOUT || '15000', 10);
// const DEFAULT_SUBPAGES_COUNT = parseInt(process.env.DEFAULT_SUBPAGES_COUNT || '5', 10);
// const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '1', 10);

// // Interface for the request body
// interface ProcessWebsiteRequest {
//   url: string;
//   subpagesCount?: number;
//   keywords?: string[];
//   excludePatterns?: string[];
//   maxDepth?: number;
// }

// // Interface for the aggregated website results
// interface WebsiteProcessResult {
//   success: boolean;
//   message: string;
//   url: string;
//   content: string;
//   mainContent: string;
//   metadata: any;
//   page_urls: { url: string, text: string }[];
//   social_urls: { platform: string, url: string }[];
//   contact_urls: { url: string, text: string, type: string }[];
//   image_urls: { url: string, alt: string, context: string }[];
//   external_urls: { url: string, text: string }[];
//   requestId: string;
//   timestamp: number;
//   processingTimeMs: number;
//   subpages: any[];
//   stats: {
//     totalUrls: {
//       pages: number;
//       social: number;
//       contact: number;
//       images: number;
//       external: number;
//     };
//     subpagesRequested: number;
//     subpagesSelected: number;
//     subpagesProcessed: number;
//     subpagesFailed: number;
//   };
// }

// /**
//  * Route handler for processing an entire website
//  */
// router.post('/api/processWebsite', async (req: Request, res: Response) => {
//   // Generate a unique request ID
//   const requestId = Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
//   const startTime = Date.now();
  
//   try {
//     // Extract and validate request parameters
//     const { 
//       url, 
//       subpagesCount = DEFAULT_SUBPAGES_COUNT,
//       keywords = [], 
//       excludePatterns = [
//         '/login', '/signin', '/signup', '/register', '/account',
//         '/privacy', '/terms', '/cookies', '/gdpr', '/contact',
//         '/cart', '/checkout', '/basket', '/purchase', '/buy'
//       ],
//       maxDepth = 2
//     } = req.body as ProcessWebsiteRequest;
    
//     logger.info(`[${requestId}] Processing website request for: ${url} with ${subpagesCount} subpages`);
    
//     // Format and normalize URL
//     let formattedUrl = url.trim().toLowerCase();
    
//     // Normalize URLs to standard form
//     if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
//       formattedUrl = `https://${formattedUrl}`;
//     }
//     formattedUrl = formattedUrl.replace(/^http:\/\//, 'https://');
    
//     // Validate URL after formatting
//     if (!formattedUrl || !validator.isURL(formattedUrl, { require_protocol: true })) {
//       return sendErrorResponse(res, ErrorCode.INVALID_URL, 'Invalid URL provided', requestId);
//     }
    
  
//     // Call processWithRetry function directly
//     logger.info(`[${requestId}] Processing main page: ${formattedUrl}`);
    
//     const mainPageResult = await processWithRetry(formattedUrl, requestId, MAX_RETRIES);
    
//     logger.debug(`[${requestId}] Received main page result for: ${formattedUrl}`);
    
//     // Check if we have a valid result
//     if (!mainPageResult) {
//       logger.error(`[${requestId}] Failed to process main page: ${formattedUrl}`);
//       return res.status(500).json({
//         success: false,
//         message: 'Failed to process main page',
//         error: 'No result returned',
//         requestId,
//         timestamp: Date.now()
//       });
//     }
    
//     // Instead of trying to parse, just use the content directly
//     const contentToUse = mainPageResult.mainContent || mainPageResult.content || '';

//     // Extract page URLs correctly from the response based on its structure
//     let pageUrls = [];
//     logger.debug(`[${requestId}] Extracting page URLs from the main page result`);

//     // Handle different response formats from processWithRetry
//     if (mainPageResult.page_urls && Array.isArray(mainPageResult.page_urls)) {
//       logger.debug(`[${requestId}] Found page_urls directly in the response`);
//       pageUrls = mainPageResult.page_urls;
//     } else if (mainPageResult.all_urls && mainPageResult.all_urls.page_urls && Array.isArray(mainPageResult.all_urls.page_urls)) {
//       logger.debug(`[${requestId}] Found page_urls under all_urls in the response`);
//       pageUrls = mainPageResult.all_urls.page_urls;
//     } else {
//       logger.warn(`[${requestId}] No page URLs found in the response, using empty array`);
//     }

//     logger.info(`[${requestId}] Found ${pageUrls.length} total page URLs from the main page`);
    
//     // Extract and prioritize subpage URLs from the main page result
//     const selectedSubpageUrls = selectBestSubpages(
//       pageUrls,
//       formattedUrl,
//       subpagesCount,
//       keywords,
//       excludePatterns,
//       maxDepth
//     );
    
//     // Normalize the main URL for comparison
//     const normalizedMain = new URL(formattedUrl).toString().replace(/\/$/, '')
//       .replace(/^https?:\/\//, '')
//       .replace(/^www\./, '');

//     // Step 2: Filter out the main URL and deduplicate subpages
//     const seenUrls = new Set<string>();
//     const filteredSubpageUrls = selectedSubpageUrls.filter(url => {
//       // Normalize subpage URL
//       const normalizedSubpage = new URL(url).toString().replace(/\/$/, '')
//         .replace(/^https?:\/\//, '')
//         .replace(/^www\./, '');
      
//       // Check if it's the main URL
//       if (normalizedSubpage === normalizedMain) {
//         return false;
//       }
      
//       // Check if we've seen this URL before
//       if (seenUrls.has(normalizedSubpage)) {
//         return false;
//       }
      
//       // Add to seen URLs and keep this one
//       seenUrls.add(normalizedSubpage);
//       return true;
//     });
    
//     // Log the selected URLs for debugging
//     logger.info(`[${requestId}] Selected ${filteredSubpageUrls.length} subpages for processing after filtering`);
//     if (filteredSubpageUrls.length > 0) {
//       logger.debug(`[${requestId}] Selected subpages: ${JSON.stringify(filteredSubpageUrls)}`);
//     }
    
//     // Initialize all URL collections with data from main page response
//     const allUniquePageUrls = new Map<string, { url: string, text: string }>();
//     const allUniqueSocialUrls = new Map<string, { platform: string, url: string }>();
//     const allUniqueContactUrls = new Map<string, { url: string, text: string, type: string }>();
//     const allUniqueImageUrls = new Map<string, { url: string, alt: string, context: string }>();
//     const allUniqueExternalUrls = new Map<string, { url: string, text: string }>();
    
//     // Add URLs from main page
//     if (mainPageResult.page_urls) {
//       mainPageResult.page_urls.forEach((item: { url: string, text: string }) => {
//         allUniquePageUrls.set(item.url, item);
//       });
//     } else if (mainPageResult.all_urls && mainPageResult.all_urls.page_urls) {
//       mainPageResult.all_urls.page_urls.forEach((item: { url: string, text: string }) => {
//         allUniquePageUrls.set(item.url, item);
//       });
//     }
    
//     if (mainPageResult.social_urls) {
//       mainPageResult.social_urls.forEach((item: { platform: string, url: string }) => {
//         allUniqueSocialUrls.set(item.url, item);
//       });
//     } else if (mainPageResult.all_urls && mainPageResult.all_urls.social_urls) {
//       mainPageResult.all_urls.social_urls.forEach((item: { platform: string, url: string }) => {
//         allUniqueSocialUrls.set(item.url, item);
//       });
//     }
    
//     if (mainPageResult.contact_urls) {
//       mainPageResult.contact_urls.forEach((item: { url: string, text: string, type: string }) => {
//         allUniqueContactUrls.set(item.url, item);
//       });
//     } else if (mainPageResult.all_urls && mainPageResult.all_urls.contact_urls) {
//       mainPageResult.all_urls.contact_urls.forEach((item: { url: string, text: string, type: string }) => {
//         allUniqueContactUrls.set(item.url, item);
//       });
//     }
    
//     if (mainPageResult.image_urls) {
//       mainPageResult.image_urls.forEach((item: { url: string, alt: string, context: string }) => {
//         allUniqueImageUrls.set(item.url, item);
//       });
//     } else if (mainPageResult.all_urls && mainPageResult.all_urls.image_urls) {
//       mainPageResult.all_urls.image_urls.forEach((item: { url: string, alt: string, context: string }) => {
//         allUniqueImageUrls.set(item.url, item);
//       });
//     }
    
//     if (mainPageResult.external_urls) {
//       mainPageResult.external_urls.forEach((item: { url: string, text: string }) => {
//         allUniqueExternalUrls.set(item.url, item);
//       });
//     } else if (mainPageResult.all_urls && mainPageResult.all_urls.external_urls) {
//       mainPageResult.all_urls.external_urls.forEach((item: { url: string, text: string }) => {
//         allUniqueExternalUrls.set(item.url, item);
//       });
//     }
    
//     // After collecting all URLs from main page and subpages
//     // Remove social URLs from external URLs
//     allUniqueSocialUrls.forEach((item, url) => {
//       allUniqueExternalUrls.delete(url);
//     });
    
//     // Create initial content with main page data
//     let combinedContent = `## Home Page # ${mainPageResult.metadata?.title || 'Website Content'}\n\n`;
//     combinedContent += `## Main Page: ${mainPageResult.metadata?.title || 'Homepage'}\n\n`;
//     combinedContent += `${contentToUse}\n\n`;
    
//     // Process subpages with concurrency control
//     const subpageResults = await scrapeSubpagesWithConcurrencyLimit(
//       filteredSubpageUrls,
//       MAX_CONCURRENT_SUBPAGE_REQUESTS,
//       SUBPAGE_REQUEST_TIMEOUT,
//       requestId,
//       req.headers
//     );
    
//     // Calculate statistics
//     const successfulSubpages = subpageResults.filter(result => result.success);
//     const failedSubpages = subpageResults.filter(result => !result.success);
    
//     logger.info(`[${requestId}] Subpage processing completed: ${successfulSubpages.length} successful, ${failedSubpages.length} failed`);
    
//     // Add subpage content to combinedContent and collect URLs
//     successfulSubpages.forEach((result, index) => {
//       // Add page content
//       combinedContent += `## Subpage ${index + 1}: ${result.metadata?.title || result.url || `Subpage ${index + 1}`}\n\n`;
//       combinedContent += `${result.mainContent || result.content || ''}\n\n`;
      
//       // Collect URLs
//       if (result.page_urls) {
//         result.page_urls.forEach((item: { url: string, text: string }) => {
//           if (!allUniquePageUrls.has(item.url)) {
//             allUniquePageUrls.set(item.url, item);
//           }
//         });
//       } else if (result.all_urls && result.all_urls.page_urls) {
//         result.all_urls.page_urls.forEach((item: { url: string, text: string }) => {
//           if (!allUniquePageUrls.has(item.url)) {
//             allUniquePageUrls.set(item.url, item);
//           }
//         });
//       }
      
//       if (result.social_urls) {
//         result.social_urls.forEach((item: { platform: string, url: string }) => {
//           if (!allUniqueSocialUrls.has(item.url)) {
//             allUniqueSocialUrls.set(item.url, item);
//           }
//         });
//       } else if (result.all_urls && result.all_urls.social_urls) {
//         result.all_urls.social_urls.forEach((item: { platform: string, url: string }) => {
//           if (!allUniqueSocialUrls.has(item.url)) {
//             allUniqueSocialUrls.set(item.url, item);
//           }
//         });
//       }
      
//       if (result.contact_urls) {
//         result.contact_urls.forEach((item: { url: string, text: string, type: string }) => {
//           if (!allUniqueContactUrls.has(item.url)) {
//             allUniqueContactUrls.set(item.url, item);
//           }
//         });
//       } else if (result.all_urls && result.all_urls.contact_urls) {
//         result.all_urls.contact_urls.forEach((item: { url: string, text: string, type: string }) => {
//           if (!allUniqueContactUrls.has(item.url)) {
//             allUniqueContactUrls.set(item.url, item);
//           }
//         });
//       }
      
//       if (result.image_urls) {
//         result.image_urls.forEach((item: { url: string, alt: string, context: string }) => {
//           if (!allUniqueImageUrls.has(item.url)) {
//             allUniqueImageUrls.set(item.url, item);
//           }
//         });
//       } else if (result.all_urls && result.all_urls.image_urls) {
//         result.all_urls.image_urls.forEach((item: { url: string, alt: string, context: string }) => {
//           if (!allUniqueImageUrls.has(item.url)) {
//             allUniqueImageUrls.set(item.url, item);
//           }
//         });
//       }
      
//       if (result.external_urls) {
//         result.external_urls.forEach((item: { url: string, text: string }) => {
//           if (!allUniqueExternalUrls.has(item.url)) {
//             allUniqueExternalUrls.set(item.url, item);
//           }
//         });
//       } else if (result.all_urls && result.all_urls.external_urls) {
//         result.all_urls.external_urls.forEach((item: { url: string, text: string }) => {
//           if (!allUniqueExternalUrls.has(item.url)) {
//             allUniqueExternalUrls.set(item.url, item);
//           }
//         });
//       }
//     });
    
//     // Calculate processing time
//     const processingTimeMs = Date.now() - startTime;
    
//     // Create simplified subpage results with deduplication
//     const seenFinalUrls = new Set<string>();
//     const simplifiedSubpages = successfulSubpages
//       .filter(result => {
//         const normalizedUrl = new URL(result.url).toString().replace(/\/$/, '')
//           .replace(/^https?:\/\//, '')
//           .replace(/^www\./, '');
        
//         if (seenFinalUrls.has(normalizedUrl)) {
//           return false;
//         }
        
//         seenFinalUrls.add(normalizedUrl);
//         return true;
//       })
//       .map(result => ({
//         url: result.url,
//         title: result.metadata?.title || '',
//         success: true
//       }));
    
//     // Prepare the final aggregated result
//     const aggregatedResult: WebsiteProcessResult = {
//       success: true,
//       message: `Successfully processed website with ${successfulSubpages.length} subpages`,
//       url: mainPageResult.url,
//       content: combinedContent,
//       mainContent: contentToUse,
//       metadata: mainPageResult.metadata,
//       page_urls: Array.from(allUniquePageUrls.values()),
//       social_urls: Array.from(allUniqueSocialUrls.values()),
//       contact_urls: Array.from(allUniqueContactUrls.values()),
//       image_urls: Array.from(allUniqueImageUrls.values()),
//       external_urls: Array.from(allUniqueExternalUrls.values()),
//       requestId,
//       timestamp: Date.now(),
//       processingTimeMs,
//       subpages: simplifiedSubpages,
//       stats: {
//         totalUrls: {
//           pages: allUniquePageUrls.size,
//           social: allUniqueSocialUrls.size,
//           contact: allUniqueContactUrls.size,
//           images: allUniqueImageUrls.size,
//           external: allUniqueExternalUrls.size
//         },
//         subpagesRequested: subpagesCount,
//         subpagesSelected: filteredSubpageUrls.length,
//         subpagesProcessed: successfulSubpages.length,
//         subpagesFailed: failedSubpages.length
//       }
//     };
    
//     logger.info(`[${requestId}] Completed website processing for ${formattedUrl} with ${successfulSubpages.length} subpages in ${processingTimeMs}ms`);
//     logger.debug(`[${requestId}] Collected URLs: pages=${allUniquePageUrls.size}, social=${allUniqueSocialUrls.size}, contact=${allUniqueContactUrls.size}, images=${allUniqueImageUrls.size}, external=${allUniqueExternalUrls.size}`);
    
//     // Return the aggregated result
//     return res.json(aggregatedResult);
    
//   } catch (error: any) {
//     logger.error(`[${requestId}] Error processing website: ${error.message || error}`);
//     return sendErrorResponse(
//       res,
//       ErrorCode.SCRAPING_ERROR,
//       `Failed to process website: ${error.message || 'Unknown error'}`,
//       requestId
//     );
//   }
// });

// /**
//  * Select the best subpages to scrape based on the provided criteria
//  */
// function selectBestSubpages(
//   pageUrls: { url: string, text: string }[],
//   baseUrl: string,
//   count: number,
//   keywords: string[] = [],
//   excludePatterns: string[] = [],
//   maxDepth: number = 2
// ): string[] {
//   try {
//     logger.debug(`Selecting best subpages from ${pageUrls.length} URLs with count=${count}, maxDepth=${maxDepth}`);
    
//     // Parse the base URL to get domain information
//     const parsedBaseUrl = new URL(baseUrl);
//     const baseDomain = parsedBaseUrl.hostname;
    
//     // Filter for internal links only (same domain)
//     const internalUrls = pageUrls.filter(link => {
//       try {
//         return isSameDomain(baseUrl, link.url);
//       } catch (e) {
//         // For relative URLs, assume they're internal
//         return true;
//       }
//     });
    
//     logger.debug(`Found ${internalUrls.length} internal URLs after domain filtering`);
    
//     // Normalize URLs (handle relative URLs, remove fragments, etc.)
//     const normalizedUrls = internalUrls.map(link => {
//       try {
//         const fullUrl = new URL(link.url, baseUrl).href;
//         // Remove hash fragments
//         return fullUrl.split('#')[0];
//       } catch (e) {
//         return '';
//       }
//     }).filter(url => url !== '');
    
//     // Remove duplicates
//     const uniqueUrls = [...new Set(normalizedUrls)];
//     logger.debug(`Found ${uniqueUrls.length} unique URLs after deduplication`);
    
//     // Filter out URLs matching exclude patterns
//     let filteredUrls = uniqueUrls.filter(url => {
//       return !excludePatterns.some(pattern => url.includes(pattern));
//     });
    
//     logger.debug(`Found ${filteredUrls.length} URLs after applying exclude patterns`);
    
//     // Calculate path depth for each URL
//     const urlsWithDepth = filteredUrls.map(url => {
//       const parsedUrl = new URL(url);
//       const path = parsedUrl.pathname;
//       const depth = path.split('/').filter(segment => segment.length > 0).length;
//       return { url, depth, pathLength: path.length };
//     });
    
//     // Filter by maximum depth
//     const depthFilteredUrls = urlsWithDepth.filter(item => item.depth <= maxDepth);
//     logger.debug(`Found ${depthFilteredUrls.length} URLs after applying max depth filter of ${maxDepth}`);
    
//     // Score URLs based on keywords and path characteristics
//     const scoredUrls = depthFilteredUrls.map(item => {
//       let score = 0;
      
//       // Lower depth gets higher score
//       score += (maxDepth - item.depth) * 10;
      
//       // Shorter paths are usually more important
//       score += Math.max(0, 100 - item.pathLength);
      
//       // Check for keywords in URL
//       for (const keyword of keywords) {
//         if (item.url.toLowerCase().includes(keyword.toLowerCase())) {
//           score += 20;
//         }
//       }
      
//       // Bonus for URLs with common important sections
//       const importantSections = ['/about', '/products', '/services', '/faq', '/features'];
//       for (const section of importantSections) {
//         if (item.url.toLowerCase().includes(section)) {
//           score += 15;
//         }
//       }
      
//       return { ...item, score };
//     });
    
//     // Sort by score (highest first)
//     scoredUrls.sort((a, b) => b.score - a.score);
    
//     // Log top-scoring URLs for debugging
//     if (scoredUrls.length > 0) {
//       const topScores = scoredUrls.slice(0, Math.min(5, scoredUrls.length));
//       logger.debug(`Top scoring URLs: ${JSON.stringify(topScores.map(u => ({ url: u.url, score: u.score })))}`);
//     }
    
//     // Take more URLs than needed to account for filtering
//     const overSelectedUrls = scoredUrls.slice(0, count * 2).map(item => item.url);
    
//     // Normalize the main URL for comparison
//     const normalizedMain = new URL(baseUrl).toString().replace(/\/$/, '')
//       .replace(/^https?:\/\//, '')
//       .replace(/^www\./, '');
    
//     // Extract just the core domain name for comparison
//     const mainDomainCore = normalizedMain.split('/')[0]; // Get just the domain part

//     // Filter out main URL and duplicates
//     const seenUrls = new Set<string>();
//     filteredUrls = overSelectedUrls.filter(url => {
//       const normalizedUrl = new URL(url).toString().replace(/\/$/, '')
//         .replace(/^https?:\/\//, '')
//         .replace(/^www\./, '');
      
//       // Compare just the domain parts and paths
//       const urlDomainCore = normalizedUrl.split('/')[0];
      
//       // Skip exact matches to main URL or previously seen URLs
//       if (normalizedUrl === normalizedMain || seenUrls.has(normalizedUrl)) {
//         return false;
//       }
      
//       // Make sure it's on the same domain
//       if (!urlDomainCore.includes(mainDomainCore)) {
//         return false;
//       }
      
//       seenUrls.add(normalizedUrl);
//       return true;
//     });
    
//     // Now return the requested number of URLs
//     return filteredUrls.slice(0, count);
    
//   } catch (error) {
//     logger.error(`Error selecting subpages: ${error}`);
//     // Fallback to returning the first N unique URLs
//     const fallbackUrls = [...new Set(pageUrls.map(link => {
//       try {
//         return new URL(link.url, baseUrl).href;
//       } catch (e) {
//         return '';
//       }
//     }).filter(url => url !== ''))].slice(0, count);
    
//     logger.warn(`Using fallback URL selection method, selected ${fallbackUrls.length} URLs`);
//     return fallbackUrls;
//   }
// }

// /**
//  * Process subpages with concurrency control
//  */
// async function scrapeSubpagesWithConcurrencyLimit(
//   urls: string[],
//   concurrencyLimit: number,
//   timeout: number,
//   requestId: string,
//   headers: any
// ): Promise<any[]> {
//   // Create concurrency limiter
//   const limit = pLimit(concurrencyLimit);
  
//   // Create promise for each URL with timeout
//   const promises = urls.map(url => {
//     return limit(() => {
//       return new Promise<any>(async (resolve) => {
//         const subRequestId = `${requestId}-sub-${Date.now().toString(36).substring(2, 7)}`;
//         logger.info(`[${requestId}] Processing subpage: ${url} with sub-requestId: ${subRequestId}`);
        
//         // Set a timeout for each subpage request
//         const timeoutId = setTimeout(() => {
//           logger.warn(`[${requestId}] Timeout for subpage: ${url}`);
//           resolve({
//             success: false,
//             url,
//             error: 'Subpage processing timeout',
//             message: 'Subpage processing timeout'
//           });
//         }, timeout);
        
//         try {
//           // Call processWithRetry function directly
//           const result = await processWithRetry(url, subRequestId, MAX_RETRIES);
          
//           // Clear the timeout since we got a response
//           clearTimeout(timeoutId);
          
//           // Return the result
//           resolve(result || {
//             success: false,
//             url,
//             error: 'Empty response',
//             message: 'Empty response from subpage processing'
//           });
//         } catch (error: any) {
//           // Clear the timeout since we got an error
//           clearTimeout(timeoutId);
          
//           logger.error(`[${requestId}] Error processing subpage ${url}: ${error.message || error}`);
//           resolve({
//             success: false,
//             url,
//             error: error.message || 'Unknown error',
//             message: `Error processing subpage: ${error.message || 'Unknown error'}`
//           });
//         }
//       });
//     });
//   });
  
//   // Execute all promises with the concurrency limit
//   return Promise.all(promises);
// }

// function extractDomainCore(url: string): string {
//   try {
//     // Handle raw domains without protocol
//     const urlWithProtocol = url.startsWith('http') ? url : `https://${url}`;
//     const hostname = new URL(urlWithProtocol).hostname;
    
//     // Remove www prefix
//     const withoutWww = hostname.replace(/^www\./, '');
    
//     // Get the base domain (handles multi-part TLDs like .co.uk)
//     const parts = withoutWww.split('.');
//     if (parts.length > 2) {
//       // For domains like sub.example.com, get example.com
//       return parts.slice(-2).join('.');
//     }
//     return withoutWww;
//   } catch (e) {
//     return url; // Return the original if parsing fails
//   }
// }

// export default router; 