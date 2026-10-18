const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const cors = require('cors');
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const app = express();
app.use(cors());
app.use(express.json());

cloudinary.config({
  cloud_name: 'qgtma8wv',
  api_key: '226171487848885',
  api_secret: 'MSJO8EKk5EnrCMp4hgQouDMl3bw'
});

const upload = multer({ storage: multer.memoryStorage() });

// Middleware to verify Firebase token
const verifyAuth = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken; // contains email
    next();
  } catch (e) { res.status(403).json({ error: 'Invalid Token' }); }
};

// Upload endpoint
app.post('/upload', verifyAuth, upload.single('image'), (req, res) => {
  const { description } = req.body;
  // Automatically extract username from authenticated email
  const publisher_name = req.user.email.split('@')[0].replace('.', '_');

  const uploadStream = cloudinary.uploader.upload_stream(
    { folder: 'publisher_images', context: { publisher_name, description } },
    (error, result) => {
      if (error) return res.status(500).json({ error: 'Upload failed' });
      res.status(200).json({ success: true, imageUrl: result.secure_url });
    }
  );
  uploadStream.end(req.file.buffer);
});

// GET images
app.get('/images', async (req, res) => {
  const result = await cloudinary.api.resources({ type: 'upload', prefix: 'publisher_images/', context: true });
  res.json({ images: result.resources.map(img => ({
    imageUrl: img.secure_url,
    publisherName: img.context?.custom?.publisher_name || 'Anonymous',
    description: img.context?.custom?.description || ''
  }))});
});

app.listen(3000, () => console.log('Server running'));