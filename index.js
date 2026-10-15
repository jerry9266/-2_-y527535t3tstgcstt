const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS so your frontend can communicate with this API
app.use(cors());
app.use(express.json());

// Base target configuration
const BASE_URL = 'https://downloadwella.com';

// Endpoint to resolve the download link
app.post('/api/resolve', async (req, res) => {
  const { movieId } = req.body;
  
  // 1. Input Validation: Ensure the ID is provided and alphanumeric
  if (!movieId || typeof movieId !== 'string') {
    return res.status(400).json({ error: 'Movie ID is required.' });
  }
  
  // Sanitize to allow only safe identifier characters (alphanumeric, dashes, underscores)
  const sanitizedId = movieId.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(sanitizedId)) {
    return res.status(400).json({ error: 'Invalid Movie ID format.' });
  }
  
  const targetUrl = `${BASE_URL}/${sanitizedId}`;
  
  try {
    // 2. Fetch the target page HTML
    const response = await axios.get(targetUrl, {
      headers: {
        // Providing a standard user-agent prevents basic blocking
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
      },
      timeout: 10000 // 10-second timeout
    });
    
    // 3. Parse the HTML using Cheerio
    const $ = cheerio.load(response.data);
    
    let downloadUrl = null;
    
    /**
     * CSS Selector Configuration:
     * Replace the selector below with the actual tag, class, or attribute
     * used on downloadwella.com for the direct link.
     *
     * Common patterns:
     * - $('a#download_button').attr('href')
     * - $('a[href*=".mp4"]').attr('href')
     * - $('video source').attr('src')
     */
    
    // Example: Looking for an anchor tag containing "download" in its href or text
    $('a').each((i, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().toLowerCase();
      
      if (href && (text.includes('download') || href.includes('.mp4') || href.includes('dl='))) {
        downloadUrl = href;
        return false; // Break the loop
      }
    });
    
    // Fallback: If not found, check video tags
    if (!downloadUrl) {
      downloadUrl = $('video source').attr('src') || $('video').attr('src');
    }
    
    if (!downloadUrl) {
      return res.status(404).json({
        error: 'Could not locate a download link on the target page. The selector may need adjustment.'
      });
    }
    
    // 4. Send the extracted URL back to the client
    return res.json({
      success: true,
      movieId: sanitizedId,
      downloadUrl: downloadUrl
    });
    
  } catch (error) {
    if (error.response && error.response.status === 404) {
      return res.status(404).json({ error: 'Target page not found.' });
    }
    
    return res.status(500).json({
      error: 'Failed to retrieve or process the target page.',
      details: error.message
    });
  }
});

// Health check route for Render
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});