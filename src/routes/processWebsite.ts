import { Router, Request, Response, NextFunction } from 'express';
import { ErrorCode, sendErrorResponse } from '../utils/errorHandler';
import winston from 'winston';
import validator from 'validator';
import { URL } from 'url';
import pLimit from 'p-limit';
// Import processLinks router and the processWebsite function
import { processWithRetry } from '../processLinks';
import { browserManager } from '../browserManager';

// Local implementation of isSameDomain
function isSameDomain(baseUrl: string, testUrl: string): boolean {
    const baseHostname = new URL(baseUrl).hostname.replace(/^www\./, '');
    const testHostname = new URL(testUrl).hostname.replace(/^www\./, '');
    return baseHostname === testHostname;
}

// Create a logger instance
const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'scrapebase-website' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp }) => {
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

const router = Router();

// Configure concurrency and timeout limits
const MAX_CONCURRENT_SUBPAGE_REQUESTS = parseInt(process.env.MAX_CONCURRENT_SUBPAGE_REQUESTS || '10', 10);
const SUBPAGE_REQUEST_TIMEOUT = parseInt(process.env.SUBPAGE_REQUEST_TIMEOUT || '15000', 10);
const DEFAULT_SUBPAGES_COUNT = parseInt(process.env.DEFAULT_SUBPAGES_COUNT || '5', 10);
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '1', 10);

// Interface for the request body
interface ProcessWebsiteRequest {
  url: string;
  subpagesCount?: number;
  keywords?: string[];
  excludePatterns?: string[];
  maxDepth?: number;
}

// Interface for the aggregated website results
interface WebsiteProcessResult {
  success: boolean;
  message: string;
  url: string;
  content: string;
  mainContent: string;
  metadata: any;
  page_urls: { url: string, text: string }[];
  social_urls: { platform: string, url: string }[];
  contact_urls: { url: string, text: string, type: string }[];
  image_urls: { url: string, alt: string, context: string }[];
  external_urls: { url: string, text: string }[];
  requestId: string;
  timestamp: number;
  processingTimeMs: number;
  subpages: any[];
  stats: {
    totalUrls: {
      pages: number;
      social: number;
      contact: number;
      images: number;
      external: number;
    };
    subpagesRequested: number;
    subpagesSelected: number;
    subpagesProcessed: number;
    subpagesFailed: number;
  };
}

/**
 * Route handler for processing an entire website
 */
router.post('/api/processWebsite', async (req: Request, res: Response) => {
  // Generate a unique request ID
  const requestId = Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
  const startTime = Date.now();
  let mainPageResult: any = null;
  
  try {
    // Extract and validate request parameters
    const { 
      url, 
      subpagesCount = DEFAULT_SUBPAGES_COUNT,
      keywords = [], 
      excludePatterns = [
        '/login', '/signin', '/signup', '/register', '/account',
        '/privacy', '/terms', '/cookies', '/gdpr', '/contact',
        '/cart', '/checkout', '/basket', '/purchase', '/buy'
      ],
      maxDepth = 2
    } = req.body as ProcessWebsiteRequest;
    
    logger.info(`[${requestId}] Processing website request for: ${url} with ${subpagesCount} subpages`);
    
    // Format and normalize URL
    let formattedUrl = url.trim().toLowerCase();
    
    // // Normalize URLs to standard form
    // if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
    //   formattedUrl = `https://${formattedUrl}`;
    // }
    // formattedUrl = formattedUrl.replace(/^http:\/\//, 'https://');
    
    // // Validate URL after formatting
    // if (!formattedUrl || !validator.isURL(formattedUrl, { require_protocol: true })) {
    //   return sendErrorResponse(res, ErrorCode.INVALID_URL, 'Invalid URL provided', requestId);
    // }
    
    // Call processWithRetry function directly
    logger.info(`[${requestId}] Processing main page: ${formattedUrl}`);
    
    mainPageResult = await processWithRetry(formattedUrl, requestId, MAX_RETRIES);
    
    logger.debug(`[${requestId}] Received main page result for: ${formattedUrl}`);
    
    // Check if we have a valid result
    if (!mainPageResult) {
      logger.error(`[${requestId}] Failed to process main page: ${formattedUrl}`);
      return res.status(500).json({
        success: false,
        message: 'Failed to process main page',
        error: 'No result returned',
        requestId,
        timestamp: Date.now()
      });
    }
    
    // Instead of trying to parse, just use the content directly
    const contentToUse = mainPageResult.mainContent || mainPageResult.content || '';

    // Extract page URLs correctly from the response based on its structure
    let pageUrls = [];
    logger.debug(`[${requestId}] Extracting page URLs from the main page result`);

    // Handle different response formats from processWithRetry
    if (mainPageResult.page_urls && Array.isArray(mainPageResult.page_urls)) {
      logger.debug(`[${requestId}] Found page_urls directly in the response`);
      pageUrls = mainPageResult.page_urls;
    } else if (mainPageResult.all_urls && mainPageResult.all_urls.page_urls && Array.isArray(mainPageResult.all_urls.page_urls)) {
      logger.debug(`[${requestId}] Found page_urls under all_urls in the response`);
      pageUrls = mainPageResult.all_urls.page_urls;
    } else {
      logger.warn(`[${requestId}] No page URLs found in the response, using empty array`);
    }

    logger.info(`[${requestId}] Found ${pageUrls.length} total page URLs from the main page`);
    
    // Extract and prioritize subpage URLs from the main page result
    const selectedSubpageUrls = selectBestSubpages(
      pageUrls,
      formattedUrl,
      subpagesCount,
      keywords,
      excludePatterns,
      maxDepth
    );
    
    // Normalize the main URL for comparison
    const normalizedMain = new URL(formattedUrl).toString().replace(/\/$/, '')
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '');

    // Step 2: Filter out the main URL and deduplicate subpages
    const seenUrls = new Set<string>();
    const filteredSubpageUrls = selectedSubpageUrls.filter(url => {
      // Normalize subpage URL
      const normalizedSubpage = new URL(url).toString().replace(/\/$/, '')
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '');
      
      // Check if it's the main URL
      if (normalizedSubpage === normalizedMain) {
        return false;
      }
      
      // Check if we've seen this URL before
      if (seenUrls.has(normalizedSubpage)) {
        return false;
      }
      
      // Add to seen URLs and keep this one
      seenUrls.add(normalizedSubpage);
      return true;
    });
    
    // Log the selected URLs for debugging
    logger.info(`[${requestId}] Selected ${filteredSubpageUrls.length} subpages for processing after filtering`);
    if (filteredSubpageUrls.length > 0) {
      logger.debug(`[${requestId}] Selected subpages: ${JSON.stringify(filteredSubpageUrls)}`);
    }
    
    // Initialize all URL collections with data from main page response
    const allUniquePageUrls = new Map<string, { url: string, text: string }>();
    const allUniqueSocialUrls = new Map<string, { platform: string, url: string }>();
    const allUniqueContactUrls = new Map<string, { url: string, text: string, type: string }>();
    const allUniqueImageUrls = new Map<string, { url: string, alt: string, context: string }>();
    const allUniqueExternalUrls = new Map<string, { url: string, text: string }>();
    
    // Add URLs from main page
    if (mainPageResult.page_urls) {
      mainPageResult.page_urls.forEach((item: { url: string, text: string }) => {
        allUniquePageUrls.set(item.url, item);
      });
    } else if (mainPageResult.all_urls && mainPageResult.all_urls.page_urls) {
      mainPageResult.all_urls.page_urls.forEach((item: { url: string, text: string }) => {
        allUniquePageUrls.set(item.url, item);
      });
    }
    
    if (mainPageResult.social_urls) {
      mainPageResult.social_urls.forEach((item: { platform: string, url: string }) => {
        allUniqueSocialUrls.set(item.url, item);
      });
    } else if (mainPageResult.all_urls && mainPageResult.all_urls.social_urls) {
      mainPageResult.all_urls.social_urls.forEach((item: { platform: string, url: string }) => {
        allUniqueSocialUrls.set(item.url, item);
      });
    }
    
    if (mainPageResult.contact_urls) {
      mainPageResult.contact_urls.forEach((item: { url: string, text: string, type: string }) => {
        allUniqueContactUrls.set(item.url, item);
      });
    } else if (mainPageResult.all_urls && mainPageResult.all_urls.contact_urls) {
      mainPageResult.all_urls.contact_urls.forEach((item: { url: string, text: string, type: string }) => {
        allUniqueContactUrls.set(item.url, item);
      });
    }
    
    if (mainPageResult.image_urls) {
      mainPageResult.image_urls.forEach((item: { url: string, alt: string, context: string }) => {
        allUniqueImageUrls.set(item.url, item);
      });
    } else if (mainPageResult.all_urls && mainPageResult.all_urls.image_urls) {
      mainPageResult.all_urls.image_urls.forEach((item: { url: string, alt: string, context: string }) => {
        allUniqueImageUrls.set(item.url, item);
      });
    }
    
    if (mainPageResult.external_urls) {
      mainPageResult.external_urls.forEach((item: { url: string, text: string }) => {
        allUniqueExternalUrls.set(item.url, item);
      });
    } else if (mainPageResult.all_urls && mainPageResult.all_urls.external_urls) {
      mainPageResult.all_urls.external_urls.forEach((item: { url: string, text: string }) => {
        allUniqueExternalUrls.set(item.url, item);
      });
    }
    
    // After collecting all URLs from main page and subpages
    // Remove social URLs from external URLs
    allUniqueSocialUrls.forEach((item, url) => {
      allUniqueExternalUrls.delete(url);
    });
    
    // Create initial content with main page data
    let combinedContent = `## Home Page # ${mainPageResult.metadata?.title || 'Website Content'}\n\n`;
    combinedContent += `## Main Page: ${mainPageResult.metadata?.title || 'Homepage'}\n\n`;
    combinedContent += `${contentToUse}\n\n`;
    
    // Process subpages with concurrency control
    const subpageResults = await scrapeSubpagesWithConcurrencyLimit(
      filteredSubpageUrls,
      MAX_CONCURRENT_SUBPAGE_REQUESTS,
      SUBPAGE_REQUEST_TIMEOUT,
      requestId,
      req.headers
    );
    
    // Calculate statistics
    const successfulSubpages = subpageResults.filter(result => result.success);
    const failedSubpages = subpageResults.filter(result => !result.success);
    
    logger.info(`[${requestId}] Subpage processing completed: ${successfulSubpages.length} successful, ${failedSubpages.length} failed`);
    
    // Add subpage content to combinedContent and collect URLs
    successfulSubpages.forEach((result, index) => {
      // Add page content
      combinedContent += `## Subpage ${index + 1}: ${result.metadata?.title || result.url || `Subpage ${index + 1}`}\n\n`;
      combinedContent += `${result.mainContent || result.content || ''}\n\n`;
      
      // Collect URLs
      if (result.page_urls) {
        result.page_urls.forEach((item: { url: string, text: string }) => {
          if (!allUniquePageUrls.has(item.url)) {
            allUniquePageUrls.set(item.url, item);
          }
        });
      } else if (result.all_urls && result.all_urls.page_urls) {
        result.all_urls.page_urls.forEach((item: { url: string, text: string }) => {
          if (!allUniquePageUrls.has(item.url)) {
            allUniquePageUrls.set(item.url, item);
          }
        });
      }
      
      if (result.social_urls) {
        result.social_urls.forEach((item: { platform: string, url: string }) => {
          if (!allUniqueSocialUrls.has(item.url)) {
            allUniqueSocialUrls.set(item.url, item);
          }
        });
      } else if (result.all_urls && result.all_urls.social_urls) {
        result.all_urls.social_urls.forEach((item: { platform: string, url: string }) => {
          if (!allUniqueSocialUrls.has(item.url)) {
            allUniqueSocialUrls.set(item.url, item);
          }
        });
      }
      
      if (result.contact_urls) {
        result.contact_urls.forEach((item: { url: string, text: string, type: string }) => {
          if (!allUniqueContactUrls.has(item.url)) {
            allUniqueContactUrls.set(item.url, item);
          }
        });
      } else if (result.all_urls && result.all_urls.contact_urls) {
        result.all_urls.contact_urls.forEach((item: { url: string, text: string, type: string }) => {
          if (!allUniqueContactUrls.has(item.url)) {
            allUniqueContactUrls.set(item.url, item);
          }
        });
      }
      
      if (result.image_urls) {
        result.image_urls.forEach((item: { url: string, alt: string, context: string }) => {
          if (!allUniqueImageUrls.has(item.url)) {
            allUniqueImageUrls.set(item.url, item);
          }
        });
      } else if (result.all_urls && result.all_urls.image_urls) {
        result.all_urls.image_urls.forEach((item: { url: string, alt: string, context: string }) => {
          if (!allUniqueImageUrls.has(item.url)) {
            allUniqueImageUrls.set(item.url, item);
          }
        });
      }
      
      if (result.external_urls) {
        result.external_urls.forEach((item: { url: string, text: string }) => {
          if (!allUniqueExternalUrls.has(item.url)) {
            allUniqueExternalUrls.set(item.url, item);
          }
        });
      } else if (result.all_urls && result.all_urls.external_urls) {
        result.all_urls.external_urls.forEach((item: { url: string, text: string }) => {
          if (!allUniqueExternalUrls.has(item.url)) {
            allUniqueExternalUrls.set(item.url, item);
          }
        });
      }
    });
    
    // Calculate processing time
    const processingTimeMs = Date.now() - startTime;
    
    // Create simplified subpage results with deduplication
    const seenFinalUrls = new Set<string>();
    const simplifiedSubpages = successfulSubpages
      .filter(result => {
        const normalizedUrl = new URL(result.url).toString().replace(/\/$/, '')
          .replace(/^https?:\/\//, '')
          .replace(/^www\./, '');
        
        if (seenFinalUrls.has(normalizedUrl)) {
          return false;
        }
        
        seenFinalUrls.add(normalizedUrl);
        return true;
      })
      .map(result => ({
        url: result.url,
        title: result.metadata?.title || '',
        success: true
      }));
    
    // Prepare the final aggregated result
    const aggregatedResult: WebsiteProcessResult = {
      success: true,
      message: `Successfully processed website with ${successfulSubpages.length} subpages`,
      url: mainPageResult.url,
      content: combinedContent,
      mainContent: contentToUse,
      metadata: mainPageResult.metadata,
      page_urls: Array.from(allUniquePageUrls.values()),
      social_urls: Array.from(allUniqueSocialUrls.values()),
      contact_urls: Array.from(allUniqueContactUrls.values()),
      image_urls: Array.from(allUniqueImageUrls.values()),
      external_urls: Array.from(allUniqueExternalUrls.values()),
      requestId,
      timestamp: Date.now(),
      processingTimeMs,
      subpages: simplifiedSubpages,
      stats: {
        totalUrls: {
          pages: allUniquePageUrls.size,
          social: allUniqueSocialUrls.size,
          contact: allUniqueContactUrls.size,
          images: allUniqueImageUrls.size,
          external: allUniqueExternalUrls.size
        },
        subpagesRequested: subpagesCount,
        subpagesSelected: filteredSubpageUrls.length,
        subpagesProcessed: successfulSubpages.length,
        subpagesFailed: failedSubpages.length
      }
    };
    
    // Return the aggregated result
    logger.info(`[${requestId}] Completed website processing for ${formattedUrl} with ${successfulSubpages.length} subpages in ${processingTimeMs}ms`);
    logger.debug(`[${requestId}] Collected URLs: pages=${allUniquePageUrls.size}, social=${allUniqueSocialUrls.size}, contact=${allUniqueContactUrls.size}, images=${allUniqueImageUrls.size}, external=${allUniqueExternalUrls.size}`);
    
    // Send response immediately to improve perceived performance
    res.json(aggregatedResult);
    
    // Check memory usage after sending response to determine if cleanup is needed
    const memInfo = process.memoryUsage();
    const memUsageMB = Math.round(memInfo.rss / (1024 * 1024));
    
    // Only do cleanup if memory usage is high
    if (memUsageMB > 500) { // Only if over 500MB
      cleanupResources(requestId);
    }
    return;
    
  } catch (error: any) {
    logger.error(`[${requestId}] Error processing website: ${error.message || error}`);
    
    // Only do cleanup on error if we had processed the main page
    // This indicates we might have used significant resources
    if (mainPageResult) {
      cleanupResources(requestId);
    }
    
    return sendErrorResponse(
      res,
      ErrorCode.SCRAPING_ERROR,
      `Failed to process website: ${error.message || 'Unknown error'}`,
      requestId
    );
  } finally {
    // Always do cleanup, not just when memory is high
    cleanupResources(requestId);
  }
});

/**
 * Select the best subpages to scrape based on the provided criteria
 */
function selectBestSubpages(
  pageUrls: { url: string, text: string }[],
  baseUrl: string,
  count: number,
  keywords: string[] = [],
  excludePatterns: string[] = [],
  maxDepth: number = 2
): string[] {
  try {
    logger.debug(`Selecting best subpages from ${pageUrls.length} URLs with count=${count}, maxDepth=${maxDepth}`);
    
    // Parse the base URL to get domain information
    const parsedBaseUrl = new URL(baseUrl);
    const baseDomain = parsedBaseUrl.hostname;
    
    // Filter for internal links only (same domain)
    const internalUrls = pageUrls.filter(link => {
      try {
        return isSameDomain(baseUrl, link.url);
      } catch (e) {
        // For relative URLs, assume they're internal
        return true;
      }
    });
    
    logger.debug(`Found ${internalUrls.length} internal URLs after domain filtering`);
    
    // Normalize URLs (handle relative URLs, remove fragments, etc.)
    const normalizedUrls = internalUrls.map(link => {
      try {
        const fullUrl = new URL(link.url, baseUrl).href;
        // Remove hash fragments
        return fullUrl.split('#')[0];
      } catch (e) {
        return '';
      }
    }).filter(url => url !== '');
    
    // Remove duplicates
    const uniqueUrls = [...new Set(normalizedUrls)];
    logger.debug(`Found ${uniqueUrls.length} unique URLs after deduplication`);
    
    // Filter out URLs matching exclude patterns
    let filteredUrls = uniqueUrls.filter(url => {
      return !excludePatterns.some(pattern => url.includes(pattern));
    });
    
    logger.debug(`Found ${filteredUrls.length} URLs after applying exclude patterns`);
    
    // Calculate path depth for each URL
    const urlsWithDepth = filteredUrls.map(url => {
      const parsedUrl = new URL(url);
      const path = parsedUrl.pathname;
      const depth = path.split('/').filter(segment => segment.length > 0).length;
      return { url, depth, pathLength: path.length };
    });
    
    // Filter by maximum depth
    const depthFilteredUrls = urlsWithDepth.filter(item => item.depth <= maxDepth);
    logger.debug(`Found ${depthFilteredUrls.length} URLs after applying max depth filter of ${maxDepth}`);
    
    // Score URLs based on keywords and path characteristics
    const scoredUrls = depthFilteredUrls.map(item => {
      let score = 0;
      
      // Lower depth gets higher score
      score += (maxDepth - item.depth) * 10;
      
      // Shorter paths are usually more important
      score += Math.max(0, 100 - item.pathLength);
      
      // Check for keywords in URL
      for (const keyword of keywords) {
        if (item.url.toLowerCase().includes(keyword.toLowerCase())) {
          score += 20;
        }
      }
      
      // Bonus for URLs with common important sections
      const importantSections = ['/about', '/products', '/services', '/faq', '/features'];
      for (const section of importantSections) {
        if (item.url.toLowerCase().includes(section)) {
          score += 15;
        }
      }
      
      return { ...item, score };
    });
    
    // Sort by score (highest first)
    scoredUrls.sort((a, b) => b.score - a.score);
    
    // Log top-scoring URLs for debugging
    if (scoredUrls.length > 0) {
      const topScores = scoredUrls.slice(0, Math.min(5, scoredUrls.length));
      logger.debug(`Top scoring URLs: ${JSON.stringify(topScores.map(u => ({ url: u.url, score: u.score })))}`);
    }
    
    // Take more URLs than needed to account for filtering
    const overSelectedUrls = scoredUrls.slice(0, count * 2).map(item => item.url);
    
    // Normalize the main URL for comparison
    const normalizedMain = new URL(baseUrl).toString().replace(/\/$/, '')
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '');
    
    // Extract just the core domain name for comparison
    const mainDomainCore = normalizedMain.split('/')[0]; // Get just the domain part

    // Filter out main URL and duplicates
    const seenUrls = new Set<string>();
    filteredUrls = overSelectedUrls.filter(url => {
      const normalizedUrl = new URL(url).toString().replace(/\/$/, '')
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '');
      
      // Compare just the domain parts and paths
      const urlDomainCore = normalizedUrl.split('/')[0];
      
      // Skip exact matches to main URL or previously seen URLs
      if (normalizedUrl === normalizedMain || seenUrls.has(normalizedUrl)) {
        return false;
      }
      
      // Make sure it's on the same domain
      if (!urlDomainCore.includes(mainDomainCore)) {
        return false;
      }
      
      seenUrls.add(normalizedUrl);
      return true;
    });
    
    // Now return the requested number of URLs
    return filteredUrls.slice(0, count);
    
  } catch (error) {
    logger.error(`Error selecting subpages: ${error}`);
    // Fallback to returning the first N unique URLs
    const fallbackUrls = [...new Set(pageUrls.map(link => {
      try {
        return new URL(link.url, baseUrl).href;
      } catch (e) {
        return '';
      }
    }).filter(url => url !== ''))].slice(0, count);
    
    logger.warn(`Using fallback URL selection method, selected ${fallbackUrls.length} URLs`);
    return fallbackUrls;
  }
}

/**
 * Process subpages with concurrency control
 */
async function scrapeSubpagesWithConcurrencyLimit(
  urls: string[],
  concurrencyLimit: number,
  timeout: number,
  requestId: string,
  headers: any
): Promise<any[]> {
  // If we have very few URLs, don't bother with batching
  if (urls.length <= concurrencyLimit) {
    return await processUrlBatch(urls, concurrencyLimit, timeout, requestId);
  }
  
  // Create concurrency limiter
  const limit = pLimit(concurrencyLimit);
  
  // Collect results
  const results: any[] = [];
  
  // Process URLs in larger batches to reduce overhead
  const batchSize = Math.min(concurrencyLimit * 2, urls.length);
  
  // Process URLs sequentially but with concurrency control
  for (let i = 0; i < urls.length; i += batchSize) {
    // Process a batch of URLs concurrently
    const batch = urls.slice(i, i + batchSize);
    const isLastBatch = i + batchSize >= urls.length;
    
    logger.info(`[${requestId}] Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(urls.length/batchSize)} (${batch.length} URLs)`);
    
    const batchResults = await processUrlBatch(batch, concurrencyLimit, timeout, requestId);
    results.push(...batchResults);
    
    // Do cleanup after each batch, not just the last one
    cleanupResources(requestId + '-batch-' + Math.floor(i/batchSize));
    
    // If memory is getting high, do more aggressive cleanup between batches
    const memInfo = process.memoryUsage();
    const memUsageMB = Math.round(memInfo.rss / (1024 * 1024));
    
    if (memUsageMB > 800) { // Lower from 1000MB to 800MB
      if (global.gc) {
        global.gc();
        logger.debug(`[${requestId}] GC performed after batch ${Math.floor(i/batchSize) + 1}`);
      }
      
      // If memory is very high, trigger context cleanup between batches
      if (memUsageMB > 1200) { // Lower from 1500MB to 1200MB
        await browserManager.releaseUnusedContexts();
      }
    }
  }
  
  // Final explicit cleanup after all subpages are processed
  // Only for main request, not individual subpages
  cleanupResources(requestId + '-all-subpages');
  
  // Only do additional cleanup if memory is very high
  const memInfo = process.memoryUsage();
  const memUsageMB = Math.round(memInfo.rss / (1024 * 1024));
  
  if (memUsageMB > 1500) { // If over 1.5GB
    logger.info(`[${requestId}] Memory usage is high (${memUsageMB}MB), triggering browser cleanup`);
    try {
      // Release unused contexts
      await browserManager.releaseUnusedContexts();
    } catch (e) {
      logger.error(`[${requestId}] Error during browser cleanup:`, e);
    }
  }
  
  return results;
}

/**
 * Process a batch of URLs with concurrency control
 */
async function processUrlBatch(
  urls: string[],
  concurrencyLimit: number,
  timeout: number,
  requestId: string
): Promise<any[]> {
  // Create concurrency limiter
  const limit = pLimit(concurrencyLimit);
  
  const batchPromises = urls.map(url => {
    return limit(() => {
      return new Promise<any>(async (resolve) => {
        const subRequestId = `${requestId}-sub-${Date.now().toString(36).substring(2, 5)}`;
        logger.info(`[${requestId}] Processing subpage: ${url} with sub-requestId: ${subRequestId}`);
        
        // Set a timeout for each subpage request
        const timeoutId = setTimeout(() => {
          logger.warn(`[${requestId}] Timeout for subpage: ${url}`);
          cleanupResources(subRequestId);
          resolve({
            success: false,
            url,
            error: 'Subpage processing timeout',
            message: 'Subpage processing timeout'
          });
        }, timeout);
        
        try {
          // Call processWithRetry function directly
          const result = await processWithRetry(url, subRequestId, MAX_RETRIES);
          
          // Clear the timeout since we got a response
          clearTimeout(timeoutId);
          
          // Immediately trigger cleanup for this subpage
          cleanupResources(subRequestId);
          
          // Return the result
          resolve(result || {
            success: false,
            url,
            error: 'Empty response',
            message: 'Empty response from subpage processing'
          });
        } catch (error: any) {
          // Clear the timeout since we got an error
          clearTimeout(timeoutId);
          
          // Immediately trigger cleanup for this subpage even on error
          cleanupResources(subRequestId);
          
          logger.error(`[${requestId}] Error processing subpage ${url}: ${error.message || error}`);
          resolve({
            success: false,
            url,
            error: error.message || 'Unknown error',
            message: `Error processing subpage: ${error.message || 'Unknown error'}`
          });
        }
      });
    });
  });
  
  // Execute all promises with concurrency control
  return await Promise.all(batchPromises);
}

function extractDomainCore(url: string): string {
  try {
    // Handle raw domains without protocol
    const urlWithProtocol = url.startsWith('http') ? url : `https://${url}`;
    const hostname = new URL(urlWithProtocol).hostname;
    
    // Remove www prefix
    const withoutWww = hostname.replace(/^www\./, '');
    
    // Get the base domain (handles multi-part TLDs like .co.uk)
    const parts = withoutWww.split('.');
    if (parts.length > 2) {
      // For domains like sub.example.com, get example.com
      return parts.slice(-2).join('.');
    }
    return withoutWww;
  } catch (e) {
    return url; // Return the original if parsing fails
  }
}

// Function to clean up resources after each request
async function cleanupResources(requestId: string) {
  try {
    logger.info(`[${requestId}] Cleaning up resources after request completion`);
    
    // Explicitly release any browser resources associated with this request
    // This should be tracked per-request if possible
    
    // Force cleanup if memory usage is high
    const memInfo = process.memoryUsage();
    const memUsageMB = Math.round(memInfo.rss / (1024 * 1024));
    
    if (memUsageMB > 400) { // Lower threshold for cleanup
      await browserManager.releaseUnusedContexts();
    }
    
    // If memory is very high, consider more aggressive cleanup
    if (memUsageMB > 800) {
      logger.info(`[${requestId}] Memory still high at ${memUsageMB}MB, forcing browser cleanup`);
      await browserManager.forceCleanupAndRestart();
    }
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
  } catch (error) {
    logger.error(`[${requestId}] Error during resource cleanup: ${error}`);
  }
}

export default router; 