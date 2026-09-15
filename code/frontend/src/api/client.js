import axios from 'axios';

const client = axios.create({
  baseURL: 'http://127.0.0.1:8000',
  timeout: 60000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT token to every request if available
client.interceptors.request.use(config => {
  const token = sessionStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default client;