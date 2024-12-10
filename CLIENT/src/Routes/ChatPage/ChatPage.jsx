import './ChatPage.css';
import NewPrompt from '../../components/newPrompt/NewPrompt';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import Markdown from 'react-markdown';

const ChatPage = () => {
  const path = useLocation().pathname;
  const chatId = path.split('/').pop();

  const { isPending, error, data } = useQuery({
    queryKey: ['chat', chatId],
    queryFn: () =>
      fetch(`${import.meta.env.VITE_API_URL}/api/chats/${chatId}`, {
        credentials: 'include',
      }).then((res) => res.json()),
  });

  console.log(data);

  return (
    <div className='chatPage'>
      <div className='wrapper'>
        <div className='chat'>
          {isPending
            ? 'Loading...'
            : error
            ? 'Something went wrong!'
            : data?.history?.map((message) => (
                <div key={message._id}>
                  {/* Render image if available */}
                  {message.img && (
                    <img
                      src={message.img} // Directly use the `img` URL from the message
                      alt='Chat Message Attachment'
                      style={{
                        height: '300px',
                        width: '400px',
                        objectFit: 'cover',
                      }} // Adjust styles as needed
                      loading='lazy'
                    />
                  )}
                  <div
                    className={
                      message.role === 'user' ? 'message user' : 'message'
                    }
                  >
                    <Markdown>{message.parts[0].text}</Markdown>
                  </div>
                </div>
              ))}

          {data && <NewPrompt data={data} />}
        </div>
      </div>
    </div>
  );
};

export default ChatPage;
