import './chatList.css';
import { Link } from 'react-router-dom';

const ChatList = () => {
  return (
    <div className='chatList'>
      <span className='title'>DASHBOARD</span>
      <Link to='/dashboard'>Create a new Chat</Link>
      <Link to='/'>Explore Lama AI</Link>
      <Link to='/'>Contact</Link>
      <hr />
      <span className='title'>Recent Chats</span>
      <div className='list'>
        <Link to='/chat/1'>Chat 1</Link>
        <Link to='/chat/2'>Chat 2</Link>
        <Link to='/chat/3'>Chat 3</Link>
        <Link to='/chat/4'>Chat 4</Link>
        <Link to='/chat/5'>Chat 5</Link>
        <Link to='/chat/6'>Chat 6</Link>
        <Link to='/chat/7'>Chat 7</Link>
        <Link to='/chat/8'>Chat 8</Link>
        <Link to='/chat/9'>Chat 9</Link>
        <Link to='/chat/10'>Chat 10</Link>
      </div>
      <hr />
      <div className='upgrade'>
        <img src='/logo.png' alt='' />
        <div className='texts'>
          <span>Upgrade to Lama AI Pro</span>
          <span>Get unlimited access to all features</span>
        </div>
      </div>
    </div>
  );
};

export default ChatList;
