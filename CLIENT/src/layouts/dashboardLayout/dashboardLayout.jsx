import { Outlet, useNavigate } from 'react-router-dom';
import './dashboardLayout.css';
import { useEffect } from 'react';
import ChatList from '../../components/chatList/chatList';
import { useAuth } from '../../lib/auth';

const DashboardLayout = () => {
  const { user, isLoaded } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoaded && !user) {
      navigate('/sign-in');
    }
  }, [isLoaded, user, navigate]);

  if (!isLoaded) return 'Loading...';

  return (
    <div className='dashboardLayout'>
      <div className='menu'>
        <ChatList />
      </div>
      <div className='content'>
        <Outlet />
      </div>
    </div>
  );
};

export default DashboardLayout;
