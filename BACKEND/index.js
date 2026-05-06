import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import Chat from './models/chat.js';
import UserChats from './models/userChats.js';
import { ClerkExpressRequireAuth } from '@clerk/clerk-sdk-node';
import axios from 'axios';
import multer from 'multer';

const port = process.env.PORT || 3000;
const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);

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

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded.');
  }

  const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  res.json({ fileUrl });
});

app.use(express.json());

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB connection successful');
  } catch (error) {
    console.error('MongoDB connection failed:', error.message);
    process.exit(1); // Exit process if connection fails
  }
};

app.post('/api/chats', ClerkExpressRequireAuth(), async (req, res) => {
  const userId = req.auth.userId;
  const { text } = req.body;

  try {
    // Send input to Qwen model via Ngrok endpoint
    const qwenResponse = await axios.post(
      'https://822a-34-127-110-18.ngrok-free.app/generate',
      {
        user_text: text,
        image_url: null, // Add logic to handle image URLs if needed
      }
    );

    const answer = qwenResponse.data.description;

    // Create a new chat in MongoDB
    const newChat = new Chat({
      userId: userId,
      history: [
        { role: 'user', parts: [{ text }] },
        { role: 'model', parts: [{ text: answer }] },
      ],
    });

    const savedChat = await newChat.save();

    // Update or create user chats
    const userChats = await UserChats.find({ userId: userId });
    if (!userChats.length) {
      const newUserChats = new UserChats({
        userId: userId,
        chats: [
          {
            _id: savedChat._id,
            title: text.substring(0, 40),
          },
        ],
      });
      await newUserChats.save();
    } else {
      await UserChats.updateOne(
        { userId: userId },
        {
          $push: {
            chats: {
              _id: savedChat._id,
              title: text.substring(0, 40),
            },
          },
        }
      );
    }

    res.status(201).send(savedChat._id);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error creating chat!');
  }
});
app.get('/api/userchats', ClerkExpressRequireAuth(), async (req, res) => {
  const userId = req.auth.userId;

  try {
    const userChats = await UserChats.find({ userId });

    res.status(200).send(userChats[0].chats);
  } catch (err) {
    console.log(err);
    res.status(500).send('Error fetching userchats!');
  }
});

app.get('/api/chats/:id', ClerkExpressRequireAuth(), async (req, res) => {
  const userId = req.auth.userId;

  try {
    const chat = await Chat.findOne({ _id: req.params.id, userId });

    res.status(200).send(chat);
  } catch (err) {
    console.log(err);
    res.status(500).send('Error fetching chat!');
  }
});

app.put('/api/chats/:id', ClerkExpressRequireAuth(), async (req, res) => {
  const userId = req.auth.userId;
  const { question, img } = req.body;

  try {
    // Forward question and image URL to the Qwen model
    const qwenResponse = await axios.post(
      'https://822a-34-127-110-18.ngrok-free.app/generate',
      {
        user_text: question,
        image_url: img || null, // Include the image URL if provided
      }
    );

    const answer = qwenResponse.data.description;

    // Update chat history in MongoDB
    const newItems = [
      {
        role: 'user',
        parts: [{ text: question }],
        img: img || null, // Save the image URL if provided
      },
      {
        role: 'model',
        parts: [{ text: answer }],
      },
    ];

    const updatedChat = await Chat.updateOne(
      { _id: req.params.id, userId },
      {
        $push: {
          history: {
            $each: newItems,
          },
        },
      }
    );

    res.status(200).send(updatedChat);
    console.log('Updated MongoDB document:', updatedChat);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error updating chat!');
  }
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(401).send('Unauthenticated!');
});

// PRODUCTION
app.use(express.static(path.join(__dirname, '../client/dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist', 'index.html'));
});

app.listen(port, () => {
  connectDB();
  console.log('Server running on 3000');
});

app.post('/api/generate', async (req, res) => {
  try {
    const { user_text, image_url } = req.body;

    // Validate inputs
    if (!user_text && !image_url) {
      return res.status(400).json({
        error: 'Either user_text or image_url must be provided.',
      });
    }

    // Prepare payload for Flask
    const payload = {};
    if (user_text) payload.user_text = user_text;
    if (image_url) payload.image_url = image_url;

    // Log the payload for debugging
    console.log('Payload sent to Flask:', payload);

    // Forward the payload to the Flask app
    const response = await axios.post(
      'https://822a-34-127-110-18.ngrok-free.app/generate', // Flask app URL
      payload,
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );

    // Send Flask response back to the frontend
    res.status(200).json(response.data);
  } catch (err) {
    console.error('Error in /api/generate:', err.message);

    // Handle errors gracefully
    const status = err.response?.status || 500;
    const errorData = err.response?.data || { error: 'Internal Server Error' };
    res.status(status).json(errorData);
  }
});
