const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors()); // Allows your frontend to connect without cross-origin issues
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Hardcoded Cloudinary Configuration (As requested)
cloudinary.config({
    cloud_name: 'qgtma8wv',
    api_key: '226171487848885',
    api_secret: 'MSJO8EKk5EnrCMp4hgQouDMl3bw'
});

// Configure Multer to hold files in memory temporarily
const storage = multer.memoryStorage();
const upload = multer({ storage });

/**
 * POST /upload
 * Receives the image file, title, publisher_name, and description.
 * Uploads them all to Cloudinary, attaching the text data as Image Metadata.
 */
app.post('/upload', upload.single('image'), (req, res) => {
    const { title, publisher_name, description } = req.body;
    
    if (!req.file) {
        return res.status(400).json({ error: 'Image file is required' });
    }
    
    // Upload to Cloudinary using a stream (perfect for memoryStorage)
    const uploadStream = cloudinary.uploader.upload_stream(
        {
            folder: 'publisher_images',
            // This is where we attach the metadata directly to the image asset
            context: {
                title: title || 'Untitled',
                publisher_name: publisher_name || 'Unknown Publisher',
                description: description || 'No description provided'
            }
        },
        (error, result) => {
            if (error) {
                console.error('Upload Error:', error);
                return res.status(500).json({ error: 'Failed to upload image to Cloudinary' });
            }
            
            res.status(200).json({
                message: 'Upload successful',
                data: {
                    imageUrl: result.secure_url,
                    public_id: result.public_id,
                    metadata: result.context ? result.context.custom : {}
                }
            });
        }
    );
    
    // Execute the upload stream
    uploadStream.end(req.file.buffer);
});

/**
 * GET /images
 * Fetches the uploaded images from Cloudinary along with their attached metadata.
 * The front end will use this to display the images, titles, descriptions, and publishers.
 */
app.get('/images', async (req, res) => {
    try {
        // Search for uploaded files in Cloudinary, instructing it to return the attached metadata (context)
        const result = await cloudinary.api.resources({
            type: 'upload',
            prefix: 'publisher_images/', // Fetching only from the folder we created
            context: true, // VERY IMPORTANT: Tells Cloudinary to return our metadata
            max_results: 50
        });
        
        // Format the response for the frontend
        const images = result.resources.map(img => {
            const metadata = img.context && img.context.custom ? img.context.custom : {};
            
            return {
                id: img.public_id,
                imageUrl: img.secure_url,
                title: metadata.title || 'Untitled',
                publisherName: metadata.publisher_name || 'Unknown Publisher',
                description: metadata.description || 'No description'
            };
        });
        
        res.status(200).json({ images });
    } catch (error) {
        console.error('Fetch Error:', error);
        res.status(500).json({ error: 'Failed to fetch images from Cloudinary' });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Node.js Backend Server is running on port ${port}`);
});