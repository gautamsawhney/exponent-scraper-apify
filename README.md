# Exponent Questions Scraper

This Apify actor scrapes questions from [tryexponent.com](https://www.tryexponent.com/questions) and extracts comprehensive data including question text, company names, dates, tags, answer counts, and answer page URLs.

## Features

- **Comprehensive Data Extraction**: Scrapes all 202 pages of questions
- **Smart Company Detection**: Identifies company names from multiple sources including badges, links, and text content
- **Robust Date Parsing**: Handles various date formats and converts to DD/MM/YYYY
- **Tag Extraction**: Collects all relevant tags and categories
- **Answer Counting**: Accurately counts answers using multiple detection methods
- **Rate Limiting**: Respectful scraping with configurable delays
- **Error Handling**: Comprehensive error logging and recovery
- **CSV Export**: Data automatically exported in CSV format
- **Authentication Support**: Use API tokens or cookies to avoid empty pages and rate limiting

## Data Fields

The scraper extracts the following information for each question:

| Field | Description | Example |
|-------|-------------|---------|
| `questionText` | The main question text | "How would you improve YouTube's recommendation algorithm?" |
| `companyNames` | Companies mentioned or associated with the question | "Google, YouTube" |
| `askedWhen` | Date when the question was asked | "15/12/2023" |
| `tags` | Categories and tags | "System Design, Algorithms, Machine Learning" |
| `answerCount` | Number of answers | 5 |
| `showPageLink` | URL to the question page with all answers | "https://www.tryexponent.com/questions/5452/..." |

## Configuration

### Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `startPage` | integer | 1 | Starting page number (1-202) |
| `endPage` | integer | 50 | Ending page number (1-202) |
| `rateLimitMs` | integer | 1000 | Delay between requests in milliseconds |
| `useApifyProxy` | boolean | true | Whether to use Apify's proxy service |
| `apiToken` | string | - | Your Exponent API token for authenticated requests |
| `cookies` | string | - | Your browser cookies from logged-in Exponent session |
| `userAgent` | string | Chrome UA | Custom user agent string to mimic real browser |

### Example Input

```json
{
  "startPage": 1,
  "endPage": 50,
  "rateLimitMs": 1000,
  "useApifyProxy": true,
  "apiToken": "your_api_token_here",
  "cookies": "session=abc123; user_id=456; auth_token=xyz789"
}
```

## Authentication Setup

To avoid empty pages and rate limiting, you can use authentication:

### Option 1: API Token (Recommended)
1. Log into your Exponent account
2. Go to your profile/settings
3. Look for API or Developer section
4. Generate an API token
5. Use it in the `apiToken` field

### Option 2: Browser Cookies
1. Log into Exponent in your browser
2. Open Developer Tools (F12)
3. Go to Network tab
4. Refresh the page
5. Find any request to tryexponent.com
6. Copy the Cookie header value
7. Paste it in the `cookies` field

### How to Get Cookies:
1. **Chrome/Edge**: F12 → Application → Cookies → tryexponent.com
2. **Firefox**: F12 → Storage → Cookies → tryexponent.com
3. **Safari**: Develop → Show Web Inspector → Storage → Cookies

## Usage

### On Apify Platform

1. **Deploy the Actor**: Upload this code to Apify
2. **Configure Input**: Set your desired parameters and authentication
3. **Run the Actor**: Start the scraping process
4. **Download Results**: Get your data in CSV format

### Local Development

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Set Environment Variables** (optional):
   ```bash
   export APIFY_TOKEN=your_apify_token
   ```

3. **Run the Scraper**:
   ```bash
   npm start
   ```

## How It Works

1. **Index Page Processing**: Scrapes each paginated index page to extract question URLs
2. **Question Detail Scraping**: Visits each individual question page to extract detailed information
3. **Data Extraction**: Uses multiple selectors and patterns to ensure robust data extraction
4. **CSV Generation**: Automatically formats data for easy analysis

## Rate Limiting & Respect

The scraper is designed to be respectful to the target website:
- Default delay of 1000ms between requests
- Configurable rate limiting
- Reduced concurrency (2 concurrent requests)
- Maximum 30 requests per minute
- Authentication support to avoid blocking

## Error Handling

The scraper includes comprehensive error handling:
- Failed request logging
- Empty data detection
- Graceful degradation when elements are missing
- Detailed error reporting for debugging
- Authentication error handling

## Output Format

Data is automatically exported in CSV format with the following columns:
- Question Text
- Company Names
- Asked When (DD/MM/YYYY)
- Tags
- Count of Answers
- Answers URL

## Troubleshooting

### Common Issues

1. **Empty Results**: 
   - Check if the website structure has changed
   - Try using authentication (API token or cookies)
   - Verify you're not being rate limited

2. **Rate Limiting**: 
   - Increase `rateLimitMs` if you're getting blocked
   - Use authentication to access more content
   - Ensure `useApifyProxy` is enabled if needed

3. **Authentication Issues**:
   - Verify your API token is valid
   - Check if cookies are expired
   - Ensure you're logged into Exponent

### Debugging

The scraper logs detailed information:
- Page processing status
- Question extraction results
- Error details for failed requests
- Data quality warnings
- Authentication status

## Legal & Ethical Considerations

- This scraper is for educational and research purposes
- Respect the website's robots.txt and terms of service
- Use appropriate rate limiting to avoid overwhelming the server
- Consider reaching out to the website owners for permission if scraping large amounts of data
- Use authentication only with your own account credentials

## Support

For issues or questions:
1. Check the Apify console logs for error details
2. Verify your input parameters are correct
3. Ensure the target website is accessible
4. Check if the website structure has changed
5. Verify your authentication credentials are valid

## License

This project is provided as-is for educational purposes. Please ensure compliance with applicable laws and website terms of service.