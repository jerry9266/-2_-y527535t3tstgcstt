const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

cloudinary.config({
    cloud_name: 'qgtma8wv',
    api_key: '226171487848885',
    api_secret: 'MSJO8EKk5EnrCMp4hgQouDMl3bw'
});

const storage = multer.memoryStorage();
const upload = multer({ storage });

// POST: Upload with publisher_name and description
app.post('/upload', upload.single('image'), (req, res) => {
    const { publisher_name, description } = req.body;
    
    if (!req.file) return res.status(400).json({ error: 'Image is required' });
    
    const uploadStream = cloudinary.uploader.upload_stream(
        {
            folder: 'publisher_images',
            context: {
                publisher_name: publisher_name || 'Anonymous',
                description: description || 'No description'
            }
        },
        (error, result) => {
            if (error) return res.status(500).json({ error: 'Upload failed' });
            res.status(200).json({ message: 'Success', imageUrl: result.secure_url });
        }
    );
    uploadStream.end(req.file.buffer);
});

// GET: Retrieve all images with metadata
app.get('/images', async (req, res) => {
    try {
        const result = await cloudinary.api.resources({
            type: 'upload',
            prefix: 'publisher_images/',
            context: true,
            max_results: 50
        });
        
        const images = result.resources.map(img => ({
            id: img.public_id,
            imageUrl: img.secure_url,
            publisherName: img.context?.custom?.publisher_name || 'Anonymous',
            description: img.context?.custom?.description || 'No description'
        }));
        
        res.status(200).json({ images });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch' });
    }
});

app.listen(port, () => console.log(`Server running on port ${port}`));