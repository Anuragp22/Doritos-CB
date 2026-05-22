import jwt from 'jsonwebtoken';

export const requireAuth = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export const signToken = (userId) =>
  jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });

export const cookieOptions = () => {
  // In production the client (Vercel) and API (Render) are on different
  // sites, so the auth cookie must be SameSite=None; Secure to be sent at
  // all. Locally both are on localhost, where Lax works and Secure would
  // break plain-HTTP dev.
  const crossSite = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    sameSite: crossSite ? 'none' : 'lax',
    secure: crossSite,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
};
