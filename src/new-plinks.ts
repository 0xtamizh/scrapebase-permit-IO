// import { Router, Request, Response } from 'express';
// import { browserManager } from './browserManager';
// import { requestQueue } from './utils/requestQueue';
// import { disposeDom, cleanupResources } from './utils/memory';
// import { navigateToPage } from './utils/pageNavigation';
// import { ErrorCode, sendErrorResponse, parseError } from './utils/errorHandler';
// import { JSDOM } from 'jsdom';
// import { Readability } from '@mozilla/readability';
// import TurndownService from 'turndown';
// import winston from 'winston';
// import validator from 'validator';

// // Create a logger instance
// const logger = winston.createLogger({
//   level: 'debug', // Show ALL logs including debug
//   format: winston.format.combine(
//     winston.format.timestamp(),
//     winston.format.json()
//   ),
//   defaultMeta: { service: 'scrapebase-links' },
//   transports: [
//     new winston.transports.Console({
//       format: winston.format.combine(
//         winston.format.colorize(),
//         winston.format.printf(({ level, message, timestamp }) => {
//           // Truncate long messages to prevent console flooding
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

// // Read timeouts from environment or use defaults
// const GLOBAL_REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT || '60000', 10);
// const PAGE_NAVIGATION_TIMEOUT = parseInt(process.env.PAGE_TIMEOUT || '180000', 10);
// const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '1', 10);

// // Keep the original interfaces
// interface ExtractedContent {
//   title: string;
//   description: string;
//   content: string;
//   navigation: string;
//   headers: string[];
//   mainContent: string;
//   footerContent: string;
//   siteName: string | null;
//   language: string;
//   url: string;
//   type: string;
//   excerpt?: string;
// }

// interface ProcessResult {
//   success: boolean;
//   message: string;
//   url?: string;
//   details?: string;
//   source?: string;
//   error?: string;
//   status?: string;
//   content?: string;
//   rawHtml?: string;
//   rawPageData?: any;
//   mainContent?: string;
//   preview?: string;
//   page_urls?: { url: string, text: string }[];
//   social_urls?: { platform: string, url: string }[];
//   contact_urls?: { url: string, text: string, type: string }[];
//   image_urls?: { url: string, alt: string, context: string }[];
//   external_urls?: { url: string, text: string }[];
//   metadata: MetadataInfo;
//   requestId?: string;
//   timestamp?: number;
//   footerContent: string;
// }

// interface RawPageData {
//   header: SectionData;
//   main: MainSectionData;
//   footer: SectionData;
//   navigation: NavigationData;
//   metadata: MetadataInfo;
//   socialLinks: SocialLink[];
//   allLinks: PageLink[];
//   allImages: ImageInfo[];
// }

// interface SectionData {
//   html: string;
//   text: string;
//   links: string[];
//   images: string[];
// }

// interface MainSectionData extends SectionData {
//   fullHtml: string;
// }

// interface NavigationData {
//   menu: string[];
//   links: NavLink[];
// }

// interface NavLink {
//   text: string;
//   url: string;
// }

// interface MetadataInfo {
//   title: string;
//   description: string;
//   siteName: string;
//   type: string;
//   lang: string;
//   ogImage?: string;
//   ogDescription?: string;
// }

// interface SocialLink {
//   platform: string;
//   url: string;
// }

// interface PageLink {
//   url: string;
//   text: string;
//   type: string;
//   context: string;
// }

// interface ImageInfo {
//   src: string;
//   alt: string;
//   width?: number;
//   height?: number;
//   context: string;
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
  
//   // Already getting truncated by the logger
//   return content;
// }

// /**
//  * Extract content from HTML using Readability
//  */
// async function extractContent(html: string, url: string): Promise<ExtractedContent> {
//   const dom = new JSDOM(html, { url });
//   const reader = new Readability(dom.window.document, {
//     charThreshold: 50, // Lower threshold to capture more content
//     classesToPreserve: ['content', 'article', 'main', 'footer'] // Added footer to preserve classes
//   });
//   const article = reader.parse();
  
//   if (!article) {
//     throw new Error('Failed to parse content');
//   }

//   // Extract footer content separately
//   const footerContent = extractFooterContent(dom.window.document);

//   return {
//     title: article.title || '',
//     description: article.excerpt || '',
//     content: article.content || '',
//     navigation: '',
//     headers: [],
//     mainContent: cleanText(article.textContent || ''),
//     footerContent: cleanText(footerContent),
//     siteName: article.siteName,
//     language: dom.window.document.documentElement.lang || 'en',
//     url: url,
//     type: 'article',
//     excerpt: article.excerpt || ''
//   };
// }

// /**
//  * Extract footer content from document
//  */
// function extractFooterContent(document: Document): string {
//   const footerElements = document.querySelectorAll('footer, .footer, [role="contentinfo"]');
//   let footerContent = '';
  
//   footerElements.forEach(footer => {
//     footerContent += footer.textContent || '';
//   });
  
//   return footerContent;
// }

// /**
//  * Clean text by removing excessive whitespace, tabs, and normalizing line breaks
//  */
// function cleanText(text: string): string {
//   return text
//     .replace(/\t+/g, ' ')          // Replace tabs with a single space
//     .replace(/\n\s*\n+/g, '\n')    // Replace multiple blank lines with a single newline
//     .replace(/\s{2,}/g, ' ')       // Replace multiple spaces with a single space
//     .replace(/^\s+|\s+$/gm, '')    // Trim whitespace from beginning/end of each line
//     .trim();                       // Trim the entire string
// }

// /**
//  * Primary route handler for processing web links
//  */
// export const processWebsite = router.post('/api/processLinks', async (req: Request, res: Response) => {
//   // Generate a unique request ID
//   const requestId = Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
  
//   // Extract URL from request
//   let { url } = req.body;
  
//   logger.info(`[${requestId}] Processing request for: ${url}`);
  
//   // Validate input
//   if (!url) {
//     return sendErrorResponse(
//       res,
//       ErrorCode.MISSING_PARAM,
//       'URL is required',
//       requestId
//     );
//   }
  
//   // Normalize URL
//   if (!url.startsWith('http://') && !url.startsWith('https://')) {
//     url = `https://${url}`;
//     logger.debug(`[${requestId}] Normalized URL to: ${url}`);
//   }
  
//   // Validate URL format
//   if (!validator.isURL(url, { require_protocol: true })) {
//     return sendErrorResponse(
//       res,
//       ErrorCode.INVALID_URL,
//       'Invalid URL format',
//       requestId
//     );
//   }
  
//   // Use AbortController for task cancellation
//   const abortController = new AbortController();
  
//   // Set up global timeout
//   const timeoutId = setTimeout(() => {
//     abortController.abort();
//     sendErrorResponse(
//       res,
//       ErrorCode.TIMEOUT,
//       `Request exceeded global timeout of ${GLOBAL_REQUEST_TIMEOUT}ms`,
//       requestId
//     );
//   }, GLOBAL_REQUEST_TIMEOUT);
  
//   try {
//     // Add to request queue with rate limiting
//     const result = await requestQueue.enqueue(requestId, async () => {
//       // Check if already aborted
//       if (abortController.signal.aborted) {
//         throw new Error('Request aborted');
//       }
      
//       // Process with retries
//       return await processWithRetry(url, requestId, MAX_RETRIES);
//     });
    
//     // Clear timeout as request completed
//     clearTimeout(timeoutId);
    
//     // Transform the result to match the simplified format
//     const processResult = {
//       success: true,
//       message: 'Successfully processed website',
//       url: url,
//       requestId,
//       timestamp: Date.now(),
//       metadata: result.metadata,
//       mainContent: result.mainContent,
//       content: result.content,
//       all_urls: result.all_urls
//     };
    
//     // Send success response
//     res.status(200).json(processResult);
    
//     logger.info(`[${requestId}] Request completed successfully`);
//   } catch (error) {
//     // Clear timeout
//     clearTimeout(timeoutId);
    
//     // Only send error response if we haven't already
//     if (!abortController.signal.aborted) {
//       const parsedError = parseError(error);
//       sendErrorResponse(
//         res,
//         parsedError.code,
//         parsedError.message,
//         requestId,
//         parsedError.details
//       );
//     }
//   } finally {
//     // Clean up resources
//     cleanupResources(requestId);
//   }
// });

// /**
//  * Process a URL with retry capability
//  */
// async function processWithRetry(
//   url: string, 
//   requestId: string, 
//   maxRetries: number
// ): Promise<any> {
//   let lastError: Error | null = null;
  
//   for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
//     try {
//       logger.info(`[${requestId}] Processing attempt ${attempt}/${maxRetries + 1}`);
      
//       // Process the URL and return result
//       const result = await processUrl(url, requestId);
//       return result;
//     } catch (error) {
//       lastError = error instanceof Error ? error : new Error(String(error));
//       logger.error(`[${requestId}] Attempt ${attempt} failed: ${lastError.message}`);
      
//       // Only retry if we have attempts left
//       if (attempt <= maxRetries) {
//         // Exponential backoff
//         const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
//         logger.info(`[${requestId}] Retrying in ${backoffMs}ms...`);
//         await new Promise(resolve => setTimeout(resolve, backoffMs));
//       }
//     }
//   }
  
//   // If we get here, all retries failed
//   throw lastError || new Error('All retries failed with unknown error');
// }

// /**
//  * Process a single URL to extract content
//  */
// async function processUrl(url: string, requestId: string): Promise<any> {
//   return await browserManager.withPage(async (page) => {
//     let dom: JSDOM | null = null;

//     console.log("jsut logging using normal method: running processUrl for url: ", url)
    
//     try {
//       logger.info(`[${requestId}] Processing URL: ${url}`);
      
//       // Use enhanced navigation with better waiting strategy - use domcontentloaded instead of networkidle
//       const navigationSuccess = await navigateToPage(page, url, {
//         waitUntil: 'domcontentloaded',
//         timeout: PAGE_NAVIGATION_TIMEOUT,
//         requestId
//       });
      
//       if (!navigationSuccess) {
//         throw new Error('Failed to navigate to page');
//       }
      
//       // Block OneTrust and cookie consent scripts
//       await page.route(
//         (url) => url.toString().includes('onetrust') || 
//                  url.toString().includes('cookielaw.org') || 
//                  url.toString().includes('cookie-consent'),
//         (route) => route.abort()
//       );
      
//       // Check if page has meaningful content before further processing
//       const hasContent = await page.evaluate(() => {
//         const textContent = document.body.textContent || '';
//         return textContent.length > 200; // Consider page has content if more than 200 chars
//       });
      
//       if (!hasContent) {
//         logger.warn(`[${requestId}] Page has insufficient content, returning minimal result`);
//         return {
//           success: true,
//           url,
//           metadata: {
//             title: await page.title(),
//             description: '',
//             siteName: '',
//             type: 'website',
//             lang: 'en'
//           },
//           content: 'Page has insufficient content',
//           mainContent: 'Page has insufficient content'
//         };
//       }
      
//       // Collect data from the page - use Promise.all for parallel execution
//       const [
//         pageData,
//         navigationData,
//         socialData,
//         imageData,
//         allLinksData,
//         contactData,
//         footerData,
//         pageContent
//       ] = await Promise.all([
//         page.evaluate(() => ({
//           metadata: {
//             title: document.title,
//             description: (document.querySelector('meta[name="description"]') as HTMLMetaElement)?.content || '',
//             siteName: (document.querySelector('meta[property="og:site_name"]') as HTMLMetaElement)?.content || '',
//             type: (document.querySelector('meta[property="og:type"]') as HTMLMetaElement)?.content || 'website',
//             lang: document.documentElement.lang || 'en',
//             ogImage: (document.querySelector('meta[property="og:image"]') as HTMLMetaElement)?.content || ''
//           }
//         })),
//         page.evaluate(() => {
//           const navElements = Array.from(document.querySelectorAll('nav, [role="navigation"], header'));
//           const links = navElements.flatMap(nav => 
//             Array.from(nav.querySelectorAll('a')).map(a => ({
//               text: a.textContent?.trim() || '',
//               url: a.href
//             }))
//           );
//           return { links };
//         }),
//         page.evaluate(() => {
//           const socialPlatforms = [
//             { name: 'twitter', patterns: ['twitter.com', 't.co'] },
//             { name: 'facebook', patterns: ['facebook.com', 'fb.com'] },
//             { name: 'instagram', patterns: ['instagram.com'] },
//             { name: 'linkedin', patterns: ['linkedin.com'] },
//             { name: 'youtube', patterns: ['youtube.com'] },
//             { name: 'tiktok', patterns: ['tiktok.com'] },
//             { name: 'reddit', patterns: ['reddit.com'] },
//             { name: 'github', patterns: ['github.com'] }
//           ];
          
//           return Array.from(document.querySelectorAll('a[href]'))
//             .map(a => ({ url: (a as HTMLAnchorElement).href }))
//             .filter(({ url }) => 
//               socialPlatforms.some(platform => 
//                 platform.patterns.some(pattern => url.includes(pattern))
//               )
//             )
//             .map(({ url }) => {
//               const platform = socialPlatforms.find(p => 
//                 p.patterns.some(pattern => url.includes(pattern))
//               )?.name || 'other';
//               return { platform, url };
//             });
//         }),
//         page.evaluate(() => {
//           return Array.from(document.querySelectorAll('img'))
//             .map(img => ({
//               src: (img as HTMLImageElement).src,
//               alt: (img as HTMLImageElement).alt,
//               width: (img as HTMLImageElement).width,
//               height: (img as HTMLImageElement).height,
//               context: img.closest('article, section, div')?.textContent?.substring(0, 100) || ''
//             }))
//             .filter(img => img.src && img.src.startsWith('http'));
//         }),
//         page.evaluate(() => {
//           return Array.from(document.querySelectorAll('a[href]'))
//             .map(a => ({
//               url: (a as HTMLAnchorElement).href,
//               text: a.textContent?.trim() || '',
//               type: (a as HTMLAnchorElement).href.startsWith(window.location.origin) ? 'internal' : 'external',
//               context: a.closest('article, section, div')?.textContent?.substring(0, 100) || ''
//             }))
//             .filter(link => link.url && link.url.startsWith('http'));
//         }),
//         page.evaluate(() => {
//           // Improved regular expressions for identifying contact data
//           // More restrictive phone regex that matches legitimate formats
//           const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
          
//           // Identify contact service URLs
//           const contactServices = [
//             { type: 'calendar', patterns: ['calendly.com', 'cal.com', 'youcanbook.me', 'meetingbird.com', 'doodle.com', 'meetbot'] },
//             { type: 'meeting', patterns: ['meet.google.com', 'zoom.us', 'teams.microsoft.com', 'webex.com', 'gotomeeting.com'] },
//             { type: 'form', patterns: ['forms.', 'typeform', 'surveymonkey', 'formstack', 'wufoo', 'jotform'] },
//             { type: 'chat', patterns: ['intercom', 'zendesk', 'livechat', 'tawk.to', 'drift.com', 'olark', 'chatwoot'] }
//           ];
          
//           const contactLinks: { url: string, text: string, type: string, context?: string }[] = [];
          
//           // Extract all links that could be contact-related
//           const links = Array.from(document.querySelectorAll('a[href]'));
          
//           // Process each link
//           links.forEach(link => {
//             const href = (link as HTMLAnchorElement).href;
//             const text = link.textContent?.trim() || '';
//             const context = link.closest('article, section, div')?.textContent?.substring(0, 100) || '';
            
//             // Check for mailto: links (emails)
//             if (href.startsWith('mailto:')) {
//               // Check if this email is already added
//               if (!contactLinks.some(existing => existing.url === href)) {
//                 contactLinks.push({
//                   url: href,
//                   text: text || href.substring(7),
//                   type: 'email',
//                   context
//                 });
//               }
//               return;
//             }
            
//             // Check for meeting/calendar services
//             for (const service of contactServices) {
//               if (service.patterns.some(pattern => href.includes(pattern))) {
//                 // Check if this service link is already added
//                 if (!contactLinks.some(existing => existing.url === href)) {
//                   contactLinks.push({
//                     url: href,
//                     text: text,
//                     type: service.type,
//                     context
//                   });
//                 }
//                 return;
//               }
//             }
//           });
          
//           // Extract emails and phone numbers from text - simplified for performance
//           const allText = document.body.textContent?.substring(0, 15000) || ''; // Only check first 15K chars
          
//           // Find emails in text
//           const emailMatches = allText.match(new RegExp(emailRegex, 'g')) || [];
//           const uniqueEmails = [...new Set(emailMatches)].slice(0, 5); // Deduplicate and limit to 5
          
//           // Add emails found in text
//           uniqueEmails.forEach(email => {
//             const mailtoUrl = `mailto:${email}`;
//             if (!contactLinks.some(link => link.url === mailtoUrl)) {
//               contactLinks.push({
//                 url: mailtoUrl,
//                 text: email,
//                 type: 'email',
//                 context: '' // Add empty context for text-extracted emails
//               });
//             }
//           });
          
//           return contactLinks;
//         }),
//         page.evaluate(() => {
//           // Enhanced footer extraction - simplified for performance
//           const footerElements = document.querySelectorAll('footer, .footer, [role="contentinfo"]');
//           let rawText = '';
          
//           footerElements.forEach(footer => {
//             rawText += footer.textContent || '';
//           });
          
//           // Basic text cleaning instead of complex regex
//           return rawText.substring(0, 1000).trim(); // Only keep first 1000 chars
//         }),
//         page.content()
//       ]);
      
//       // Extract main content with Readability
//       dom = new JSDOM(pageContent, { url });
      
//       // Configure Readability to extract the main content
//       const reader = new Readability(dom.window.document, {
//         charThreshold: 50,
//         classesToPreserve: ['content', 'article', 'main']
//       });
//       const article = reader.parse();
      
//       if (!article) {
//         throw new Error('Failed to parse content with Readability');
//       }
      
//       // Clean the article text content
//       const cleanedTextContent = article.textContent
//         ? cleanText(article.textContent)
//         : '';
      
//       // Simplified markdown conversion - only do basic processing to save time
//       let markdownContent = '';
      
//       // Add title and metadata
//       markdownContent += `# ${pageData.metadata.title}\n\n`;
//       markdownContent += article.content ? cleanText(article.textContent || '') : '';
      
//       // Function to ensure all images are included in the content - simplified
//       function removeDuplicates<T extends {url?: string}>(items: T[]): T[] {
//         const seen = new Set<string>();
//         return items.filter(item => {
//           const url = item.url || '';
//           if (seen.has(url)) return false;
//           seen.add(url);
//           return true;
//         });
//       }

//       // Process links and organize them for the response - limit counts for performance
//       const allUrls = {
//         page_urls: removeDuplicates(
//           allLinksData
//             .filter(link => link.type === 'internal')
//             .slice(0, 30) // Limit to 30 internal links
//             .map(link => ({
//               url: link.url,
//               text: cleanText(link.text)
//             }))
//         ),
        
//         social_urls: removeDuplicates(
//           socialData.map(link => ({
//             platform: link.platform,
//             url: link.url
//           }))
//         ),
        
//         image_urls: removeDuplicates(
//           imageData
//           .filter(img => (img.width > 100 || img.height > 100))
//           .slice(0, 20) // Limit to 20 images
//           .map(img => ({
//             url: img.src,
//             alt: img.alt,
//             context: cleanText(img.context)
//           }))
//         ),
        
//         external_urls: removeDuplicates(
//           allLinksData
//             .filter(link => link.type === 'external')
//             .slice(0, 20) // Limit to 20 external links
//             .map(link => ({
//               url: link.url,
//               text: cleanText(link.text)
//             }))
//         ),
        
//         contact_urls: removeDuplicates(
//           contactData
//             .filter(contact => {
//               return (contact.type === 'email' || 
//                       contact.type === 'calendar' || 
//                       contact.type === 'meeting' ||
//                       contact.type === 'chat' ||
//                       contact.type === 'form');
//             })
//             .map(contact => ({
//               url: contact.url,
//               text: cleanText(contact.text),
//               type: contact.type
//             }))
//         )
//       };
      
//       // Return the final result with simplified structure
//       return {
//         success: true,
//         url,
//         metadata: pageData.metadata,
//         content: markdownContent,
//         mainContent: cleanedTextContent,
//         footer: footerData,
//         all_urls: allUrls
//       };
//     } finally {
//       // Ensure DOM is properly disposed to prevent memory leaks
//       if (dom) {
//         disposeDom(dom);
//       }
//     }
//   });
// }

// function getNavigationData() {
//   const navElements = Array.from(document.querySelectorAll('nav, [role="navigation"], header'));
  
//   const links = navElements.flatMap(nav => 
//     Array.from(nav.querySelectorAll('a')).map(a => ({
//       text: a.textContent?.trim() || '',
//       url: (a as HTMLAnchorElement).href
//     }))
//   );
  
//   const menuItems = Array.from(
//     document.querySelectorAll('nav li, header li, [role="navigation"] li')
//   ).map(li => li.textContent?.trim() || '')
//     .filter(text => text.length > 0);
  
//   return {
//     links,
//     menu: menuItems
//   };
// }

// function getSocialLinks() {
//   const socialPlatforms = [
//     { name: 'twitter', patterns: ['twitter.com', 't.co'] },
//     { name: 'facebook', patterns: ['facebook.com', 'fb.com'] },
//     { name: 'instagram', patterns: ['instagram.com'] },
//     { name: 'linkedin', patterns: ['linkedin.com'] },
//     { name: 'youtube', patterns: ['youtube.com'] },
//     { name: 'tiktok', patterns: ['tiktok.com'] },
//     { name: 'reddit', patterns: ['reddit.com'] },
//     { name: 'github', patterns: ['github.com'] }
//   ];
  
//   return Array.from(document.querySelectorAll('a[href]'))
//     .map(a => ({ url: (a as HTMLAnchorElement).href }))
//     .filter(({ url }) => 
//       socialPlatforms.some(platform => 
//         platform.patterns.some(pattern => url.includes(pattern))
//       )
//     )
//     .map(({ url }) => {
//       const platform = socialPlatforms.find(p => 
//         p.patterns.some(pattern => url.includes(pattern))
//       )?.name || 'other';
//       return { platform, url };
//     });
// }

// function getAllImages() {
//   return Array.from(document.querySelectorAll('img'))
//     .map(img => ({
//       src: (img as HTMLImageElement).src,
//       alt: (img as HTMLImageElement).alt,
//       width: (img as HTMLImageElement).width,
//       height: (img as HTMLImageElement).height,
//       context: img.closest('article, section, div')?.textContent?.substring(0, 100) || ''
//     }))
//     .filter(img => img.src && img.src.startsWith('http'));
// }

// function getAllLinks() {
//   return Array.from(document.querySelectorAll('a[href]'))
//     .map(a => ({
//       url: (a as HTMLAnchorElement).href,
//       text: a.textContent?.trim() || '',
//       type: (a as HTMLAnchorElement).href.startsWith(window.location.origin) ? 'internal' : 'external',
//       context: a.closest('article, section, div')?.textContent?.substring(0, 100) || ''
//     }))
//     .filter(link => link.url && link.url.startsWith('http'));
// }


// export { processWithRetry };


// export default router; 