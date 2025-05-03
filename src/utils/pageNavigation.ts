import { Page } from 'playwright';
import winston from 'winston';

const logger = winston.createLogger({
  level: 'debug', // Show ALL logs including debug
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'scrapebase-navigation' },
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
 * Navigation options with improved defaults
 */
interface NavigationOptions {
  timeout?: number;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  maxScrollTime?: number;
  minScrollTime?: number;
  scrollByPixels?: number;
  scrollInterval?: number;
  waitForImages?: boolean;
  stabilityDelay?: number;
  requestId?: string;
}

/**
 * Navigate to a URL with enhanced stability checks and smart waiting
 */
export async function navigateToPage(
  page: Page, 
  url: string, 
  options: NavigationOptions = {}
): Promise<boolean> {
  const {
    timeout = 30000,
    waitUntil = 'domcontentloaded',
    maxScrollTime = 10000,
    minScrollTime = 500,
    scrollByPixels = 250,
    scrollInterval = 100,
    waitForImages = false,
    stabilityDelay = 500,
    requestId = 'unknown'
  } = options;
  
  try {
    logger.debug(`[${requestId}] Navigating to ${url} (waitUntil: ${waitUntil})`);
    
    // Navigate to the URL with appropriate wait strategy
    await page.goto(url, {
      timeout,
      waitUntil
    });
    
    // Wait for any additional stabilization (using shorter timeout)
    await page.waitForFunction(() => {
      // Check for navigation timing API
      const [navigationEntry] = performance.getEntriesByType('navigation');
      return navigationEntry && (navigationEntry as any).loadEventEnd > 0;
    }, { timeout: Math.min(timeout, 5000) }).catch(() => {
      // If timing API check fails, continue anyway
      logger.debug(`[${requestId}] Navigation timing API check failed, continuing anyway`);
    });
    
    // Optional: wait for images to load (only if explicitly requested)
    if (waitForImages) {
      await page.waitForFunction(() => {
        const images = Array.from(document.querySelectorAll('img'));
        return images.every(img => img.complete);
      }, { timeout: Math.min(timeout, 5000) }).catch(() => {
        // Ignore timeout - some images might never load
        logger.debug(`[${requestId}] Some images didn't finish loading, continuing anyway`);
      });
    }
    
    // Small delay to let any immediate post-load scripts run
    await page.waitForTimeout(stabilityDelay);
    
    // Check if the page has dynamic content that requires scrolling
    const hasDynamicContent = await page.evaluate(() => {
      // Check for infinite scroll indicators
      const hasLazyLoad = !!document.querySelector('[data-lazy], [data-src], [loading="lazy"]');
      const hasInfiniteScroll = !!document.querySelector('.infinite-scroll, .load-more, #infinite, .pagination');
      
      // Check for common infinite scroll framework classes
      const hasScrollClasses = document.body.innerHTML.includes('scroll') && 
                              (document.body.innerHTML.includes('load-more') || 
                               document.body.innerHTML.includes('infinite'));
      
      return hasLazyLoad || hasInfiniteScroll || hasScrollClasses;
    });
    
    // Only perform smart scroll if page might have dynamic content
    if (hasDynamicContent) {
      await smartScroll(page, {
        maxScrollTime,
        minScrollTime,
        scrollByPixels,
        scrollInterval,
        requestId
      });
    } else {
      logger.debug(`[${requestId}] Skipping smart scroll - no dynamic content detected`);
    }
    
    return true;
  } catch (error) {
    logger.error(`[${requestId}] Navigation failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Smart adaptive scrolling based on page content and dynamics
 */
async function smartScroll(
  page: Page, 
  options: {
    maxScrollTime: number,
    minScrollTime: number,
    scrollByPixels: number,
    scrollInterval: number,
    requestId: string
  }
): Promise<void> {
  const { maxScrollTime, minScrollTime, scrollByPixels, scrollInterval, requestId } = options;
  
  logger.debug(`[${requestId}] Starting smart scroll`);
  
  try {
    // Get initial page height
    const initialHeight = await page.evaluate(() => document.body.scrollHeight);
    
    // Early exit if page is very short (less than 2 viewport heights)
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    if (initialHeight < viewportHeight * 2) {
      logger.debug(`[${requestId}] Page too short (${initialHeight}px), skipping smart scroll`);
      return;
    }
    
    // Use a more efficient scrolling implementation that exits early if no changes detected
    const scrollResult = await page.evaluate(
      async ({ maxScrollTime, minScrollTime, scrollByPixels, scrollInterval }) => {
        return await new Promise<{heightChanged: boolean, finalHeight: number, totalScrolled: number, scrollTime: number}>((resolve) => {
          const startTime = Date.now();
          let lastHeight = document.body.scrollHeight;
          let noChangeCount = 0;
          let totalScrolled = 0;
          
          const scrollDown = () => {
            const elapsed = Date.now() - startTime;
            
            // Check if we've reached the bottom or max time
            if (
              (window.scrollY + window.innerHeight >= document.body.scrollHeight - 50) || // Within 50px of bottom
              (elapsed >= maxScrollTime) ||
              (noChangeCount >= 3) // Stop after 3 consecutive scrolls with no height change
            ) {
              // If we've barely started scrolling, ensure we do minimum scrolling
              if (elapsed < minScrollTime && totalScrolled < window.innerHeight) {
                window.scrollBy(0, window.innerHeight);
                totalScrolled += window.innerHeight;
              }
              
              resolve({
                heightChanged: document.body.scrollHeight !== lastHeight,
                finalHeight: document.body.scrollHeight,
                totalScrolled: totalScrolled,
                scrollTime: elapsed
              });
              return;
            }
            
            // Check if height changed
            if (document.body.scrollHeight === lastHeight) {
              noChangeCount++;
            } else {
              lastHeight = document.body.scrollHeight;
              noChangeCount = 0;
            }
            
            // Continue scrolling
            window.scrollBy(0, scrollByPixels);
            totalScrolled += scrollByPixels;
            setTimeout(scrollDown, scrollInterval);
          };
          
          // Start scrolling
          scrollDown();
        });
      },
      { maxScrollTime, minScrollTime, scrollByPixels, scrollInterval }
    );
    
    // Get final page height 
    const finalHeight = await page.evaluate(() => document.body.scrollHeight);
    const scrollDelta = finalHeight - initialHeight;
    
    logger.debug(`[${requestId}] Smart scroll complete. Page height changed from ${initialHeight} to ${finalHeight} (delta: ${scrollDelta}px) in ${scrollResult.scrollTime}ms`);
    
    // Return to top of page
    await page.evaluate(() => window.scrollTo(0, 0));
  } catch (error) {
    // Don't let scrolling errors fail the entire navigation
    logger.warn(`[${requestId}] Error during smart scroll: ${error instanceof Error ? error.message : String(error)}`);
  }
} 