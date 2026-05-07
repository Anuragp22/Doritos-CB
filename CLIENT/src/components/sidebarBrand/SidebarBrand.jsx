import { Link } from 'react-router-dom';

const SidebarBrand = ({ className = '' }) => {
  return (
    <Link
      to="/dashboard"
      className={`px-3 py-3 font-serif text-base font-semibold tracking-tight ${className}`}
    >
      Doritos <em className="font-normal italic text-primary">AI</em>
    </Link>
  );
};

export default SidebarBrand;
