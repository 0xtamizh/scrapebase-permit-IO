# Scrapebase with Permit.io Authorization

A powerful web scraping API with fine-grained authorization controls powered by Permit.io. This project demonstrates how to implement sophisticated authorization patterns in a real-world API service.
Demo- https://scrapebase-permit.up.railway.app/
## Features

- **Tiered Access Control**: Different permissions for Free, Pro, and Admin users
- **Resource-Based Authorization**: Control access based on target domains
- **Rate Limiting**: Tier-specific rate limits enforced through policies
- **Advanced Scraping Features**: Premium capabilities restricted to Pro users
- **Real-time Policy Updates**: Changes to permissions take effect immediately
- **Audit Logging**: Track all authorization decisions

## Quick Start

1. Clone the repository:
```bash
git clone https://github.com/0xtamizh/scrapebase-permit-IO
cd scrapebase-permit-IO
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

Edit `.env` with your Permit.io API key and other configurations:
```
PERMIT_API_KEY=your_permit_api_key
ADMIN_API_KEY=2025DEVChallenge_admin
USER_API_KEY=2025DEVChallenge_user
```

4. Start the development server:
```bash
npm run dev
```

5. Visit http://localhost:3000 to access the testing UI

## Testing the Authorization Features

### Test Credentials

**Admin User:**
- Username: admin
- API Key: 2025DEVChallenge_admin

**Regular User:**
- Username: newuser
- API Key: 2025DEVChallenge_user

### Test Scenarios

1. **Basic Scraping (Free User)**
   - Use the regular user API key
   - Select "Basic" scraping mode
   - Try scraping example.com
   - Expected: Success

2. **Premium Domain Access (Free User)**
   - Use the regular user API key
   - Try scraping premium-site1.com
   - Expected: Access denied

3. **Advanced Scraping (Free User)**
   - Use the regular user API key
   - Select "Advanced" scraping mode
   - Expected: Access denied

4. **Admin Full Access**
   - Use the admin API key
   - Try any combination of sites and modes
   - Expected: All operations allowed

### Policy Structure

The authorization system uses the following policy hierarchy:

1. **Resources**
   - `website`: Represents a target scraping domain
     - Attributes: domain, is_premium

2. **Roles**
   - `admin`: Full access to all features
   - `pro_user`: Access to premium features
   - `free_user`: Basic scraping only

3. **Actions**
   - `scrape:basic`: Basic content extraction
   - `scrape:advanced`: Advanced scraping features
   - `scrape:premium`: Access to premium domains
   - `scrape:manage`: Administrative operations

#Troubleshoot

1. **"Cannot find module 'permitio'"**
   - Make sure you've run `npm install`
   - Verify permitio is in package.json

2. **"Error: Failed to launch browser"**
   - Run `npx playwright install` to install browser dependencies

3. **"Authorization service error"**
   - Check your PERMIT_API_KEY value
   - Make sure it's an Environment API Key, not a Project/Organization key
   - Verify your roles are configured correctly in the Permit.io dashboard

4. **"Access denied by Permit.io"**
   - This is working as expected! It means Permit.io is denying access based on policy
   - Check the user's role and the permission you've configured in the dashboard

5. **"If incase you are stuck in connecting permit io to app"**
   - Run the file "testPermit.js" file that will make sure connection is good are not
   - If any error, just go to permit's dashboard and check the audit log, you will know exactly whats the issue



## Implementation Details

### Authorization Flow

1. Request arrives at `/api/processLinks`
2. `permitAuth` middleware:
   - Validates API key
   - Determines user role
   - Syncs user with Permit.io
   - Checks permissions based on:
     - User role
     - Target domain
     - Requested features
3. If authorized, request proceeds to scraping logic
4. Results returned with appropriate access level

### Rate Limiting

- Free users: 50 requests/hour
- Pro users: 500 requests/hour
- Admin users: Unlimited

### Premium Features

Pro users get access to:
- Advanced content extraction
- Premium domain access
- Higher rate limits
- Full HTML structure
- JavaScript rendering

## Development

### Adding New Policies

1. Edit `policies/scrape_policy.hcl`
2. Use the Permit.io dashboard to test changes
3. Deploy updates without service restart

### Monitoring

- View authorization decisions in Permit.io dashboard
- Check audit logs for access patterns
- Monitor rate limit usage

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT 
