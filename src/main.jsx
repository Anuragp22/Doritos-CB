import React from 'react';
import ReactDOM from 'react-dom/client';
import HomePage from './Routes/HomePage/HomePage';
import './index.css';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import DashboardPage from './Routes/DashboardPage/DashboardPage';
import Chatpage from './Routes/ChatPage/ChatPage';

const router = createBrowserRouter([
  {
    path: '/',
    element: <HomePage />,
  },
  {
    children: [
      {
        path: '/',
        element: <DashboardPage />,
      },

      {
        path: '/dashboard/chats/:id',
        element: <Chatpage />,
      },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
