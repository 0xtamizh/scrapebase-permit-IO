import winston from 'winston';

const logger = winston.createLogger({
  level: 'debug', // Show ALL logs including debug
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'scrapebase-queue' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// Queue item type
type QueueItem<T> = {
  id: string;
  task: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
  abortController: AbortController;
  startTime: number;
  timeout?: NodeJS.Timeout;
};

/**
 * Simple in-memory request queue to control concurrency
 */
export class RequestQueue<T> {
  private queue: QueueItem<T>[] = [];
  private activeRequests = 0;
  private readonly maxConcurrent: number;
  private readonly requestTimeout: number;
  private readonly queueTimeout: number;
  
  constructor(
    maxConcurrent = 50, 
    requestTimeout = 60000, 
    queueTimeout = 30000
  ) {
    this.maxConcurrent = maxConcurrent;
    this.requestTimeout = requestTimeout;
    this.queueTimeout = queueTimeout;
    
    // Log queue status periodically
    setInterval(() => {
      logger.debug(`Queue status: ${this.activeRequests} active, ${this.queue.length} pending`);
    }, 10000);
  }
  
  /**
   * Add a task to the queue
   */
  public async enqueue<R extends T>(id: string, task: () => Promise<R>): Promise<R> {
    // Create abort controller for this request
    const abortController = new AbortController();
    
    // Create a promise that will be resolved when the task completes
    return new Promise<R>((resolve, reject) => {
      const queueItem: QueueItem<R> = {
        id,
        task,
        resolve,
        reject,
        abortController,
        startTime: Date.now(),
        timeout: setTimeout(() => {
          this.handleQueueTimeout(queueItem as unknown as QueueItem<T>);
        }, this.queueTimeout)
      };
      
      // Add to queue
      this.queue.push(queueItem as unknown as QueueItem<T>);
      logger.debug(`[${id}] Added to queue. Queue length: ${this.queue.length}`);
      
      // Process queue
      this.processQueue();
    });
  }
  
  /**
   * Process items in the queue
   */
  private async processQueue(): Promise<void> {
    // If we're at capacity or queue is empty, do nothing
    if (this.activeRequests >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }
    
    // Process next item
    const item = this.queue.shift();
    if (!item) return;
    
    // Clear queue timeout
    if (item.timeout) {
      clearTimeout(item.timeout);
      item.timeout = undefined;
    }
    
    // Update active requests count
    this.activeRequests++;
    const waitTime = Date.now() - item.startTime;
    logger.debug(`[${item.id}] Starting processing after ${waitTime}ms in queue`);
    
    try {
      // Check if already aborted
      if (item.abortController.signal.aborted) {
        throw new Error('Request aborted while in queue');
      }
      
      // Set up request timeout
      const timeoutId = setTimeout(() => {
        item.abortController.abort();
        item.reject(new Error(`Request timed out after ${this.requestTimeout}ms`));
      }, this.requestTimeout);
      
      // Execute the task
      const result = await item.task();
      
      // Clear timeout
      clearTimeout(timeoutId);
      
      // Resolve the promise
      item.resolve(result);
      logger.debug(`[${item.id}] Completed successfully`);
    } catch (error) {
      item.reject(error);
      logger.debug(`[${item.id}] Failed with error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      // Update active requests count
      this.activeRequests--;
      
      // Process next item
      this.processQueue();
    }
  }
  
  /**
   * Handle queue timeout for an item
   */
  private handleQueueTimeout(item: QueueItem<T>): void {
    // Check if item is still in queue
    const index = this.queue.indexOf(item);
    if (index === -1) return; // Not in queue anymore
    
    // Remove from queue
    this.queue.splice(index, 1);
    
    // Reject with timeout error
    item.reject(new Error(`Request timed out after ${this.queueTimeout}ms waiting in queue`));
    logger.debug(`[${item.id}] Timeout while waiting in queue`);
  }
  
  /**
   * Get current queue status
   */
  public getStatus(): { active: number, pending: number } {
    return {
      active: this.activeRequests,
      pending: this.queue.length
    };
  }
}

// Export a singleton instance
export const requestQueue = new RequestQueue(
  parseInt(process.env.MAX_CONCURRENT_REQUESTS || '50', 10),
  parseInt(process.env.REQUEST_TIMEOUT || '60000', 10),
  parseInt(process.env.QUEUE_TIMEOUT || '30000', 10)
); 