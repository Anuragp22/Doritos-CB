import { Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/lib/auth';
import { Toaster } from '@/components/ui/sonner';

const queryClient = new QueryClient();

const RootLayout = () => {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <Outlet />
        <Toaster position="top-right" richColors theme="light" />
      </QueryClientProvider>
    </AuthProvider>
  );
};

export default RootLayout;
