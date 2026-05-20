import axios from 'axios';

// Shared axios instance for all calls into the model service. Injects the
// MODEL_API_KEY as a Bearer token so a publicly-routable Modal endpoint
// can't be hammered by random scrapers and run up GPU spend. When the env
// var is unset (e.g. local dev hitting MODEL/server.py with no auth) we
// just send no header and the inner server treats requests as before.
const apiKey = process.env.MODEL_API_KEY;

export const modelClient = axios.create({
  headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
});
