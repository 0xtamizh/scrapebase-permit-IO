import { Router, Request, Response } from 'express';
import { permitAuth } from '../middleware/permitAuth';
import winston from 'winston';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

const logger = winston.createLogger({
    level: 'debug',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    defaultMeta: { service: 'summarize-service' },
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

// Initialize DeepInfra client with OpenAI compatibility
let deepinfra: OpenAI | null = null;

try {
    if (!process.env.DEEPINFRA_API_KEY) {
        logger.error('DEEPINFRA_API_KEY environment variable is not set');
    } else {
        deepinfra = new OpenAI({
            baseURL: 'https://api.deepinfra.com/v1/openai',
            apiKey: process.env.DEEPINFRA_API_KEY
        });
        logger.info('DeepInfra client initialized successfully');
    }
} catch (error) {
    logger.error('Failed to initialize DeepInfra client:', error);
}

const router = Router();

// Clean text by removing extra spaces and special characters
function cleanText(text: string): string {
    return text
        .replace(/[\r\n]+/g, '\n')  // Replace multiple newlines with single
        .replace(/[ \t]+/g, ' ')    // Replace multiple spaces/tabs with single space
        .replace(/[^\w\s.,!?-]/g, '') // Remove special characters except basic punctuation
        .trim();
}

interface SummaryResponse {
    key_points: string[];
    summary: string;
    sentiment: string;
}

// Summarize text using DeepInfra's Llama model
async function summarizeText(text: string): Promise<string> {
    try {
        if (!deepinfra) {
            throw new Error('DeepInfra client is not initialized. Please check your API key configuration.');
        }

        const prompt = `Please analyze the following url content and provide a structured summary in JSON format with the following fields:
- key_points: Array of main points from the text
- summary: A detailed summary of the content
- sentiment: Overall tone/sentiment of the text

Text to analyze:
${text}`;

        const response = await deepinfra.chat.completions.create({
            model: 'meta-llama/Llama-4-Scout-17B-16E-Instruct',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 4000,
            temperature: 0.7,
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(response.choices[0].message.content || '{}') as SummaryResponse;

        // Format the response in a readable way
        return `Summary:
${result.summary}

Key Points:
${result.key_points.map(point => `• ${point}`).join('\n')}

Sentiment: ${result.sentiment}`;

    } catch (error) {
        logger.error('Error calling DeepInfra API:', error);
        if (error instanceof Error) {
            throw new Error(`Failed to summarize text: ${error.message}`);
        }
        throw new Error('Failed to summarize text: Unknown error');
    }
}

// Route to process text (clean and/or summarize)
router.post('/process', permitAuth, async (req: Request, res: Response) => {
    try {
        const { text, clean = false, summarize = false } = req.body;

        if (!text) {
            return res.status(400).json({
                success: false,
                error: 'Text is required'
            });
        }

        let processedText = text;

        // Clean text if requested
        if (clean) {
            processedText = cleanText(processedText);
        }

        // Summarize text if requested (pro/admin only)
        if (summarize) {
            // The permitAuth middleware will have already checked permissions
            // and added user context to the request
            const userTier = req.user?.attributes?.tier;
            
            if (userTier !== 'pro_user' && userTier !== 'admin') {
                return res.status(403).json({
                    success: false,
                    error: 'Access denied',
                    details: 'Text summarization is only available for Pro and Admin users'
                });
            }

            try {
                processedText = await summarizeText(processedText);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                logger.error('Summarization error:', error);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to summarize text',
                    details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
                });
            }
        }

        res.json({
            success: true,
            content: processedText
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Text processing error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to process text',
            details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
        });
    }
});

export default router; 