import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import './SignUpPage.css';
import { useAuth } from '../../lib/auth';

const SignUpPage = () => {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await register(email, username, password);
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className='signUpPage'>
      <form className='authForm' onSubmit={handleSubmit}>
        <h1>Create an account</h1>
        {error && <div className='authError'>{error}</div>}
        <label>
          Email
          <input
            type='email'
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete='email'
          />
        </label>
        <label>
          Username
          <input
            type='text'
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoComplete='username'
          />
        </label>
        <label>
          Password
          <input
            type='password'
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete='new-password'
          />
        </label>
        <button type='submit' disabled={submitting}>
          {submitting ? 'Creating…' : 'Sign up'}
        </button>
        <p className='authSwitch'>
          Already have an account? <Link to='/sign-in'>Sign in</Link>
        </p>
      </form>
    </div>
  );
};

export default SignUpPage;
