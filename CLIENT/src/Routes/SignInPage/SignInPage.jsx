import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import './SignInPage.css';
import { useAuth } from '../../lib/auth';

const SignInPage = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className='signInPage'>
      <form className='authForm' onSubmit={handleSubmit}>
        <h1>Sign in</h1>
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
          Password
          <input
            type='password'
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete='current-password'
          />
        </label>
        <button type='submit' disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
        <p className='authSwitch'>
          New here? <Link to='/sign-up'>Create an account</Link>
        </p>
      </form>
    </div>
  );
};

export default SignInPage;
