const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const cors = require('cors');
const admin = require('firebase-admin');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// CONFIGURATION
// ============================================

// Neon PostgreSQL connection string hardcoded
const DATABASE_URL = "postgresql://neondb_owner:npg_NlGXs2B7pmQA@ep-hidden-cloud-b54mqwy4.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require";

// Firebase service-account initialization
if (!admin.apps.length) {
    const serviceAccount = require('./serviceAccountKey.json');

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

// Cloudinary configuration hardcoded
cloudinary.config({
    cloud_name: 'qgtma8wv',
    api_key: '226171487848885',
    api_secret: 'MSJO8EKk5EnrCMp4hgQouDMl3bw',
    secure: true
});

// Neon PostgreSQL connection pool.
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: true
    },
    max: 5,
    connectionTimeoutMillis: 10000
});

// ============================================
// MIDDLEWARE
// ============================================

const allowedOrigins = [];

app.use(cors({
    origin(origin, callback) {
        if (
            !origin ||
            allowedOrigins.length === 0 ||
            allowedOrigins.includes(origin)
        ) {
            return callback(null, true);
        }

        return callback(new Error('Origin not allowed'));
    }
}));

app.use(express.json({ limit: '1mb' }));

const upload = multer({
    storage: multer.memoryStorage(),

    limits: {
        fileSize: 10 * 1024 * 1024,
        files: 1
    },

    fileFilter(req, file, callback) {
        const allowedTypes = [
            'image/jpeg',
            'image/png',
            'image/webp',
            'image/gif'
        ];

        if (!allowedTypes.includes(file.mimetype)) {
            return callback(
                new Error('Only JPEG, PNG, WEBP and GIF images are allowed.')
            );
        }

        callback(null, true);
    }
});

// ============================================
// DATABASE INITIALIZATION
// ============================================

async function initializeDatabase() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            firebase_uid TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            email TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_unique
        ON users (LOWER(username))
    `);

    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique
        ON users (LOWER(email))
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS posts (
            id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            firebase_uid TEXT NOT NULL
                REFERENCES users(firebase_uid) ON DELETE CASCADE,
            username TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            image_url TEXT NOT NULL,
            cloudinary_public_id TEXT NOT NULL UNIQUE,
            tags TEXT[] DEFAULT '{}',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    // Ensure tags column exists for backward compatibility
    await pool.query(`
        ALTER TABLE posts ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
    `);

    console.log('Neon database tables are ready.');
}

// ============================================
// FIREBASE TOKEN VERIFICATION
// ============================================

async function verifyAuth(req, res, next) {
    const authorization = req.headers.authorization;

    if (!authorization || !authorization.startsWith('Bearer ')) {
        return res.status(401).json({
            error: 'Firebase authentication token is required.'
        });
    }

    const token = authorization.substring(7).trim();

    try {
        req.user = await admin.auth().verifyIdToken(token);
        next();
    } catch (error) {
        return res.status(401).json({
            error: 'Invalid or expired Firebase authentication token.'
        });
    }
}

// ============================================
// VALIDATION
// ============================================

function normalizeUsername(value) {
    if (typeof value !== 'string') {
        return null;
    }

    const username = value.trim();

    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
        return null;
    }

    return username;
}

// ============================================
// HEALTH CHECK
// ============================================

app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');

        res.json({
            success: true,
            server: 'online',
            database: 'connected'
        });
    } catch (error) {
        res.status(503).json({
            success: false,
            database: 'unavailable'
        });
    }
});

// ============================================
// REGISTER & GET USER PROFILE
// ============================================

app.post('/api/profile', verifyAuth, async (req, res) => {
    const username = normalizeUsername(req.body.username);
    const email = typeof req.user.email === 'string' ? req.user.email.trim().toLowerCase() : '';

    if (!username) return res.status(400).json({ error: 'Username must contain 3–30 letters, numbers or underscores.' });
    if (!email) return res.status(400).json({ error: 'The Firebase account must have an email address.' });

    try {
        const existing = await pool.query(
            `SELECT firebase_uid, username, email FROM users WHERE firebase_uid = $1`,
            [req.user.uid]
        );

        if (existing.rowCount > 0) {
            const current = existing.rows[0];
            if (current.username !== username) {
                return res.status(409).json({
                    error: 'This account already has a different username.',
                    username: current.username
                });
            }

            const updated = await pool.query(
                `UPDATE users SET email = $2, updated_at = NOW() WHERE firebase_uid = $1 RETURNING firebase_uid, username, email, created_at`,
                [req.user.uid, email]
            );

            return res.json({ success: true, user: updated.rows[0] });
        }

        const result = await pool.query(
            `INSERT INTO users (firebase_uid, username, email) VALUES ($1, $2, $3) RETURNING firebase_uid, username, email, created_at`,
            [req.user.uid, username, email]
        );

        return res.status(201).json({ success: true, user: result.rows[0] });

    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'That username or email is already registered.' });
        console.error('Profile registration failed:', error.message);
        res.status(500).json({ error: 'Could not save the user profile.' });
    }
});

app.get('/api/profile', verifyAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT firebase_uid, username, email, created_at FROM users WHERE firebase_uid = $1`,
            [req.user.uid]
        );

        if (result.rowCount === 0) return res.status(404).json({ error: 'User profile not found.' });
        res.json({ success: true, user: result.rows[0] });
    } catch (error) {
        console.error('Profile retrieval failed:', error.message);
        res.status(500).json({ error: 'Could not retrieve user profile.' });
    }
});

// ============================================
// CLOUDINARY UPLOAD HELPER
// ============================================

function uploadToCloudinary(buffer, username, description, tags) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                folder: 'publisher_images',
                resource_type: 'image',
                tags: tags,
                context: {
                    publisher_name: username,
                    description: description
                }
            },
            (error, result) => {
                if (error) {
                    return reject(error);
                }
                resolve(result);
            }
        );

        stream.end(buffer);
    });
}

// ============================================
// UPLOAD IMAGE
// ============================================

app.post('/upload', verifyAuth, upload.single('image'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'An image file is required.' });
    }

    const description = typeof req.body.description === 'string' ? req.body.description.trim().slice(0, 2000) : '';
    
    let tagsArray = [];
    if (typeof req.body.tags === 'string') {
        tagsArray = req.body.tags.split(',').map(t => t.trim()).filter(Boolean);
    }

    let profile;
    try {
        const profileResult = await pool.query(
            `SELECT firebase_uid, username, email FROM users WHERE firebase_uid = $1`,
            [req.user.uid]
        );

        if (profileResult.rowCount === 0) {
            return res.status(403).json({ error: 'No registered username was found for this account.' });
        }
        profile = profileResult.rows[0];

        if (req.body.username && req.body.username !== profile.username) {
            return res.status(403).json({ error: 'Username does not match your registered profile.' });
        }
        if (req.body.email && req.body.email.trim().toLowerCase() !== profile.email) {
            return res.status(403).json({ error: 'Email does not match your registered profile.' });
        }
    } catch (error) {
        return res.status(500).json({ error: 'Failed to verify profile before upload.' });
    }

    let image;
    try {
        image = await uploadToCloudinary(req.file.buffer, profile.username, description, tagsArray);
    } catch (error) {
        console.error('Cloudinary upload failed:', error.message);
        return res.status(500).json({ error: 'Failed to upload image to Cloudinary.' });
    }

    try {
        const postResult = await pool.query(
            `INSERT INTO posts (firebase_uid, username, description, image_url, cloudinary_public_id, tags)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, username, description, image_url, tags, created_at`,
            [req.user.uid, profile.username, description, image.secure_url, image.public_id, tagsArray]
        );

        res.status(201).json({ success: true, post: postResult.rows[0] });

    } catch (error) {
        console.error('Database insert failed:', error.message);

        let recordExists = false;
        try {
            const checkResult = await pool.query(
                `SELECT id FROM posts WHERE cloudinary_public_id = $1`, 
                [image.public_id]
            );
            if (checkResult.rowCount > 0) recordExists = true;
        } catch (checkErr) {
            console.error('Could not verify database state during rollback analysis:', checkErr.message);
        }

        if (!recordExists) {
            console.log('Rolling back Cloudinary upload due to DB failure...');
            try {
                await cloudinary.uploader.destroy(image.public_id);
            } catch (cleanupError) {
                console.error('CRITICAL ERROR: Failed to permanently clean up Cloudinary image:', cleanupError.message, 'Public ID:', image.public_id);
            }
        }

        res.status(500).json({ error: 'Database save failed. The upload process was rolled back securely.' });
    }
});

// ============================================
// GET FEED (Upgraded to Cursor Pagination)
// ============================================

app.get('/images', async (req, res) => {
    // Expecting a cursor string from the query
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor.trim() : null;

    try {
        let searchExp = cloudinary.search
            .expression('folder:publisher_images')
            .sort_by('created_at', 'desc')
            .max_results(20) // Limit reduced to 20
            .with_field('context')
            .with_field('tags');

        // Apply cursor if one was provided
        if (cursor) {
            searchExp = searchExp.next_cursor(cursor);
        }

        const result = await searchExp.execute();

        const images = result.resources.map(img => {
            const ctx = img.context || {};
            
            return {
                id: img.public_id,
                imageUrl: img.secure_url,
                publisherName: ctx.publisher_name || ctx.custom?.publisher_name || 'Anonymous',
                description: ctx.description || ctx.custom?.description || '',
                tags: img.tags || [],
                createdAt: img.created_at
            };
        });

        // Determine next page availability
        const nextCursor = result.next_cursor || null;
        const hasMore = !!nextCursor;

        res.json({
            success: true,
            images: images,
            nextCursor: nextCursor,
            hasMore: hasMore
        });

    } catch (error) {
        console.error('Cloudinary feed retrieval failed:', error.message);

        // Catch invalid pagination token specifically
        if (error.error && error.error.message && error.error.message.toLowerCase().includes('cursor')) {
            return res.status(400).json({ error: 'Invalid pagination cursor provided.' });
        }

        res.status(500).json({
            error: 'Failed to retrieve image feed from Cloudinary.'
        });
    }
});

// ============================================
// NEON SEARCH (Upgraded to Pagination)
// ============================================

app.get('/api/search', async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    
    // Parse the offset cursor (default to 0)
    let cursor = parseInt(req.query.cursor, 10);
    if (isNaN(cursor) || cursor < 0) {
        cursor = 0;
    }

    if (!query) {
        return res.json({ 
            success: true, 
            results: [], 
            nextCursor: null, 
            hasMore: false 
        });
    }

    const searchTerm = `%${query}%`;
    const limit = 20;

    try {
        // Query database with LIMIT, OFFSET, and highly consistent ordering
        const result = await pool.query(
            `SELECT
                id,
                username AS "publisherName",
                description,
                image_url AS "imageUrl",
                tags,
                created_at AS "createdAt"
             FROM posts
             WHERE username ILIKE $1
                OR description ILIKE $1
                OR array_to_string(tags, ',') ILIKE $1
             ORDER BY created_at DESC, id DESC
             LIMIT $2 OFFSET $3`,
            [searchTerm, limit, cursor]
        );

        // Determine next page availability
        const hasMore = result.rowCount === limit;
        const nextCursor = hasMore ? cursor + limit : null;

        res.json({
            success: true,
            results: result.rows,
            nextCursor: nextCursor,
            hasMore: hasMore
        });

    } catch (error) {
        console.error('Neon Search failed:', error.message);

        res.status(500).json({
            error: 'Failed to complete search query.'
        });
    }
});

// ============================================
// ERROR HANDLING
// ============================================

app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        return res.status(400).json({ error: error.message });
    }
    if (error.message && error.message.startsWith('Only JPEG')) {
        return res.status(400).json({ error: error.message });
    }
    if (error.message === 'Origin not allowed') {
        return res.status(403).json({ error: 'This origin is not permitted.' });
    }
    console.error('Server error:', error.message);
    res.status(500).json({ error: 'Unexpected server error.' });
});

// ============================================
// START SERVER
// ============================================

initializeDatabase()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Voltage backend running on port ${PORT}`);
        });
    })
    .catch(error => {
        console.error('Database initialization failed:', error.message);
        process.exit(1);
    });

process.on('SIGTERM', async () => {
    await pool.end();
    process.exit(0);
});