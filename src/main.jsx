import React from 'react';
import ReactDOM from 'react-dom/client';
import HomePage from './Routes/HomePage/HomePage';
import './index.css';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import DashboardPage from './Routes/DashboardPage/DashboardPage';
import RootLayout from './layouts/rootLayout/rootLayout';
import ChatPage from './Routes/ChatPage/ChatPage';

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: '/', element: <HomePage /> },
      {
        element: <DashboardPage />,
        children: [
          {
            path: '/dashboard',
            element: <DashboardPage />,
          },
          {
            path: '/dashboard/chat/:id',
            element: <ChatPage />,
          },
        ],
      },
      // { path: '/chat', element: <Chatpage /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
