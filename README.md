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

## Data Fields

The scraper extracts the following information for each question:

| Field | Description | Example |
|-------|-------------|---------|
| `questionText` | The main question text | "How would you improve YouTube's recommendation algorithm?" |
| `companyNames` | Companies mentioned or associated with the question | "Google, YouTube" |
| `askedWhen` | Date when the question was asked | "15/12/2023" |
| `tags` | Categories and tags | "System Design, Algorithms, Machine Learning" |
| `answerCount` | Number of answers | 5 |
| `answersUrl` | URL to the question page with all answers | "https://www.tryexponent.com/questions/5452/..." |

## Configuration

### Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `startPage` | integer | 1 | Starting page number (1-202) |
| `endPage` | integer | 202 | Ending page number (1-202) |
| `rateLimitMs` | integer | 800 | Delay between requests in milliseconds |
| `useApifyProxy` | boolean | true | Whether to use Apify's proxy service |

### Example Input

```json
{
  "startPage": 1,
  "endPage": 50,
  "rateLimitMs": 1000,
  "useApifyProxy": true
}
```

## Usage

### On Apify Platform

1. **Deploy the Actor**: Upload this code to Apify
2. **Configure Input**: Set your desired parameters
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
- Default delay of 800ms between requests
- Configurable rate limiting
- Reduced concurrency (3 concurrent requests)
- Maximum 45 requests per minute

## Error Handling

The scraper includes comprehensive error handling:
- Failed request logging
- Empty data detection
- Graceful degradation when elements are missing
- Detailed error reporting for debugging

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

1. **Empty Results**: Check if the website structure has changed
2. **Rate Limiting**: Increase `rateLimitMs` if you're getting blocked
3. **Proxy Issues**: Ensure `useApifyProxy` is enabled if needed

### Debugging

The scraper logs detailed information:
- Page processing status
- Question extraction results
- Error details for failed requests
- Data quality warnings

## Legal & Ethical Considerations

- This scraper is for educational and research purposes
- Respect the website's robots.txt and terms of service
- Use appropriate rate limiting to avoid overwhelming the server
- Consider reaching out to the website owners for permission if scraping large amounts of data

## Support

For issues or questions:
1. Check the Apify console logs for error details
2. Verify your input parameters are correct
3. Ensure the target website is accessible
4. Check if the website structure has changed

## License

This project is provided as-is for educational purposes. Please ensure compliance with applicable laws and website terms of service.