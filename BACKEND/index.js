import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import axios from 'axios';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';

import Chat from './models/chat.js';
import UserChats from './models/userChats.js';
import User from './models/user.js';
import { requireAuth, signToken, cookieOptions } from './middleware/auth.js';

const port = process.env.PORT || 3000;
const QWEN_API_URL = process.env.QWEN_API_URL;

if (!process.env.JWT_SECRET) {
  console.error('Missing JWT_SECRET in environment.');
  process.exit(1);
}
if (!QWEN_API_URL) {
  console.warn('QWEN_API_URL not set — /api/chats and /api/generate will fail.');
}

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(
      null,
      `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`
    );
  },
});
const upload = multer({ storage });

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── Auth ─────────────────────────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
  const { email, username, password } = req.body || {};
  if (!email || !username || !password) {
    return res.status(400).json({ error: 'email, username, password required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  try {
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ email, username, password: hash });

    const token = signToken(user._id.toString());
    res.cookie('token', token, cookieOptions());
    res.status(201).json({ id: user._id, email: user.email, username: user.username });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }
  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken(user._id.toString());
    res.cookie('token', token, cookieOptions());
    res.json({ id: user._id, email: user.email, username: user.username });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token', { ...cookieOptions(), maxAge: undefined });
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId).select('email username');
  if (!user) return res.status(401).json({ error: 'Unauthenticated' });
  res.json({ id: user._id, email: user.email, username: user.username });
});

// ─── Uploads ──────────────────────────────────────────────────────────

app.post('/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  res.json({ fileUrl });
});

// ─── Chats ────────────────────────────────────────────────────────────

app.post('/api/chats', requireAuth, async (req, res) => {
  const userId = req.userId;
  const { text } = req.body;

  try {
    const qwenResponse = await axios.post(QWEN_API_URL, {
      user_text: text,
      image_url: null,
    });
    const answer = qwenResponse.data.description;

    const newChat = new Chat({
      userId,
      history: [
        { role: 'user', parts: [{ text }] },
        { role: 'model', parts: [{ text: answer }] },
      ],
    });
    const savedChat = await newChat.save();

    const userChats = await UserChats.find({ userId });
    if (!userChats.length) {
      await new UserChats({
        userId,
        chats: [{ _id: savedChat._id, title: text.substring(0, 40) }],
      }).save();
    } else {
      await UserChats.updateOne(
        { userId },
        { $push: { chats: { _id: savedChat._id, title: text.substring(0, 40) } } }
      );
    }

    res.status(201).send(savedChat._id);
  } catch (err) {
    console.error('Create chat error:', err.message);
    res.status(500).json({ error: 'Error creating chat' });
  }
});

app.get('/api/userchats', requireAuth, async (req, res) => {
  try {
    const userChats = await UserChats.find({ userId: req.userId });
    res.status(200).json(userChats[0]?.chats || []);
  } catch (err) {
    console.error('Fetch userchats error:', err);
    res.status(500).json({ error: 'Error fetching userchats' });
  }
});

app.get('/api/chats/:id', requireAuth, async (req, res) => {
  try {
    const chat = await Chat.findOne({ _id: req.params.id, userId: req.userId });
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    res.status(200).json(chat);
  } catch (err) {
    console.error('Fetch chat error:', err);
    res.status(500).json({ error: 'Error fetching chat' });
  }
});

app.put('/api/chats/:id', requireAuth, async (req, res) => {
  const { question, img } = req.body;
  try {
    const qwenResponse = await axios.post(QWEN_API_URL, {
      user_text: question,
      image_url: img || null,
    });
    const answer = qwenResponse.data.description;

    const newItems = [
      { role: 'user', parts: [{ text: question }], img: img || null },
      { role: 'model', parts: [{ text: answer }] },
    ];

    const updatedChat = await Chat.updateOne(
      { _id: req.params.id, userId: req.userId },
      { $push: { history: { $each: newItems } } }
    );
    res.status(200).json(updatedChat);
  } catch (err) {
    console.error('Update chat error:', err.message);
    res.status(500).json({ error: 'Error updating chat' });
  }
});

app.post('/api/generate', requireAuth, async (req, res) => {
  try {
    const { user_text, image_url } = req.body;
    if (!user_text && !image_url) {
      return res.status(400).json({ error: 'Either user_text or image_url must be provided.' });
    }
    const payload = {};
    if (user_text) payload.user_text = user_text;
    if (image_url) payload.image_url = image_url;

    const response = await axios.post(QWEN_API_URL, payload, {
      headers: { 'Content-Type': 'application/json' },
    });
    res.status(200).json(response.data);
  } catch (err) {
    console.error('Error in /api/generate:', err.message);
    const status = err.response?.status || 500;
    const errorData = err.response?.data || { error: 'Internal Server Error' };
    res.status(status).json(errorData);
  }
});

// ─── Production static fallback ───────────────────────────────────────

app.use(express.static(path.join(__dirname, '../client/dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist', 'index.html'));
});

// ─── Error handler ────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB connection successful');
  } catch (error) {
    console.error('MongoDB connection failed:', error.message);
    process.exit(1);
  }
};

app.listen(port, () => {
  connectDB();
  console.log(`Server running on ${port}`);
});
