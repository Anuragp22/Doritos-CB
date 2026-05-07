import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { Loader2 } from 'lucide-react';
import './index.css';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import RootLayout from './layouts/rootLayout/rootLayout';

const HomePage = lazy(() => import('./Routes/HomePage/HomePage'));
const SignInPage = lazy(() => import('./Routes/SignInPage/SignInPage'));
const SignUpPage = lazy(() => import('./Routes/SignUpPage/SignUpPage'));
const PublicLayout = lazy(() =>
  import('./layouts/publicLayout/PublicLayout')
);
const DashboardLayout = lazy(() =>
  import('./layouts/dashboardLayout/dashboardLayout')
);
const DashboardPage = lazy(() =>
  import('./Routes/DashboardPage/DashboardPage')
);
const ChatPage = lazy(() => import('./Routes/ChatPage/ChatPage'));
const DocumentsPage = lazy(() =>
  import('./Routes/DocumentsPage/DocumentsPage')
);
const TrainingPage = lazy(() =>
  import('./Routes/TrainingPage/TrainingPage')
);

const RouteFallback = () => (
  <div className="flex h-full items-center justify-center text-muted-foreground">
    <Loader2 className="size-5 animate-spin" />
  </div>
);

const withSuspense = (element) => (
  <Suspense fallback={<RouteFallback />}>{element}</Suspense>
);

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      {
        element: withSuspense(<PublicLayout />),
        children: [
          { path: '/', element: withSuspense(<HomePage />) },
          { path: '/sign-in/*', element: withSuspense(<SignInPage />) },
          { path: '/sign-up', element: withSuspense(<SignUpPage />) },
        ],
      },
      {
        element: withSuspense(<DashboardLayout />),
        children: [
          { path: '/dashboard', element: withSuspense(<DashboardPage />) },
          { path: '/dashboard/chats/:id', element: withSuspense(<ChatPage />) },
          { path: '/dashboard/documents', element: withSuspense(<DocumentsPage />) },
          { path: '/dashboard/training', element: withSuspense(<TrainingPage />) },
        ],
      },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
