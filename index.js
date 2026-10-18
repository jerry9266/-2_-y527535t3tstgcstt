const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const cors = require('cors');
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json'); // Ensure this file is on your server

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

cloudinary.config({
  cloud_name: 'qgtma8wv',
  api_key: '226171487848885',
  api_secret: 'MSJO8EKk5EnrCMp4hgQouDMl3bw'
});

const upload = multer({ storage: multer.memoryStorage() });

// Middleware to verify Firebase token from frontend
const verifyAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken; // Contains user email and uid
    next();
  } catch (e) {
    return res.status(403).json({ error: 'Unauthorized or expired session' });
  }
};

// Upload Route - Extracts name from email automatically
app.post('/upload', verifyAuth, upload.single('image'), (req, res) => {
  const { description } = req.body;
  const email = req.user.email; // e.g., johndoe@gmail.com
  
  // Extract username from email and format it (e.g., johndoe -> john_doe)
  let rawName = email.split('@')[0];
  const publisher_name = rawName.replace(/[^a-zA-Z0-9]/g, '_');
  
  if (!req.file) return res.status(400).json({ error: 'Image file is required' });
  
  const uploadStream = cloudinary.uploader.upload_stream(
    {
      folder: 'publisher_images',
      context: {
        publisher_name: publisher_name,
        description: description || ''
      }
    },
    (error, result) => {
      if (error) return res.status(500).json({ error: 'Cloudinary upload failed' });
      res.status(200).json({ success: true, imageUrl: result.secure_url });
    }
  );
  uploadStream.end(req.file.buffer);
});

// GET Route - Fetches feed content
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
      description: img.context?.custom?.description || ''
    }));
    
    res.status(200).json({ images });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch feed' });
  }
});

app.listen(port, () => console.log(`Server running on port ${port}`));