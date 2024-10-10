import express from 'express';
import ImageKit from 'imagekit';
import cors from 'cors';
import mongoose from 'mongoose';

const port = process.env.PORT || 3000;

const app = express();

app.use(
  cors({
    origin: process.env.CLIENT_URL,
  })
);

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB connection successful');
  } catch (error) {
    console.error('MongoDB connection failed:', error.message);
    process.exit(1); // Exit process if connection fails
  }
};

const imagekit = new ImageKit({
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
});

app.get('/api/upload', (req, res) => {
  var result = imagekit.getAuthenticationParameters();
  console.log(result);
  res.send(result);
});

app.listen(port, () => {
  connectDB();
  console.log(`Server is running on port ${port}`);
});
