import { Link, Outlet } from 'react-router-dom';
import './rootLayout.css';

const RootLayout = () => {
  return (
    <div className='rootLayout'>
      <header className='header'>
        <Link className='logo' to='/'>
          <img src='/logo.png' alt='logo' />
          <span>DORITOS AI</span>
        </Link>
        <div className='user'>User</div>
      </header>
      <main className='main'>
        <Outlet />
      </main>
    </div>
  );
};

export default RootLayout;
