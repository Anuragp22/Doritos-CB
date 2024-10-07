import { Link } from 'react-router-dom';
import './HomePage.css';

const HomePage = () => {
  return (
    <div className='homePage'>
      <div>
        <Link to='/dashboard'>Dashboard</Link>
      </div>{' '}
      Home Page
    </div>
  );
};

export default HomePage;
