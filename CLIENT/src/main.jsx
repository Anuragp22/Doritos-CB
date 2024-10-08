import React from 'react';
import ReactDOM from 'react-dom/client';
import HomePage from './Routes/HomePage/HomePage';
import './index.css';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import DashboardPage from './Routes/DashboardPage/DashboardPage';
import RootLayout from './layouts/rootLayout/rootLayout';
import ChatPage from './Routes/ChatPage/ChatPage';
import SignInPage from './Routes/SignInPage/SignInPage';
import SignUpPage from './Routes/SignUpPage/SignUpPage';
import DashboardLayout from './layouts/dashboardLayout/dashboardLayout';

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/sign-in/*', element: <SignInPage /> },
      { path: '/sign-up', element: <SignUpPage /> },
      {
        element: <DashboardLayout />,
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
