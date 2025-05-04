import express from 'express';
import winston from 'winston';
import fs from 'fs';
import path from 'path';

const router = express.Router();
const logger = winston.createLogger({
    level: 'debug',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    defaultMeta: { service: 'blacklist-router' },
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

// Store blacklisted domains in a JSON file
const BLACKLIST_FILE = path.join(__dirname, '../../data/blacklist.json');

// Ensure data directory exists
if (!fs.existsSync(path.dirname(BLACKLIST_FILE))) {
    fs.mkdirSync(path.dirname(BLACKLIST_FILE), { recursive: true });
}

// Initialize blacklist from file or create empty one
let blacklistedDomains: Set<string>;
try {
    const data = fs.readFileSync(BLACKLIST_FILE, 'utf8');
    blacklistedDomains = new Set(JSON.parse(data));
} catch (error) {
    blacklistedDomains = new Set<string>();
    // Create empty blacklist file
    fs.writeFileSync(BLACKLIST_FILE, JSON.stringify(Array.from(blacklistedDomains)));
}

// Save blacklist to file
const saveBlacklist = () => {
    fs.writeFileSync(BLACKLIST_FILE, JSON.stringify(Array.from(blacklistedDomains)));
};

// Get all blacklisted domains
router.get('/', (req, res) => {
    try {
        res.json(Array.from(blacklistedDomains));
    } catch (error) {
        logger.error('Error fetching blacklist:', error);
        res.status(500).json({ error: 'Failed to fetch blacklist' });
    }
});

// Add domain to blacklist
router.post('/', (req, res) => {
    const { domain } = req.body;
    
    if (!domain) {
        return res.status(400).json({ error: 'Domain is required' });
    }

    try {
        blacklistedDomains.add(domain.toLowerCase());
        saveBlacklist();
        res.json({ success: true, domain });
    } catch (error) {
        logger.error('Error adding to blacklist:', error);
        res.status(500).json({ error: 'Failed to add domain to blacklist' });
    }
});

// Remove domain from blacklist
router.delete('/:domain', (req, res) => {
    const { domain } = req.params;

    try {
        const success = blacklistedDomains.delete(domain.toLowerCase());
        if (success) {
            saveBlacklist();
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Domain not found in blacklist' });
        }
    } catch (error) {
        logger.error('Error removing from blacklist:', error);
        res.status(500).json({ error: 'Failed to remove domain from blacklist' });
    }
});

// Check if a domain is blacklisted
export const isBlacklisted = (domain: string): boolean => {
    return blacklistedDomains.has(domain.toLowerCase());
};

// Get all blacklisted domains
export const getBlacklistedDomains = (): string[] => {
    return Array.from(blacklistedDomains);
};

export default router; 