import { Link } from 'react-router-dom';

const SidebarBrand = ({ className = '' }) => {
  return (
    <Link
      to="/dashboard"
      className={`flex items-center gap-2 px-3 py-3 font-serif text-base font-semibold ${className}`}
    >
      <img src="/logo.png" alt="" className="size-6" />
      <span>
        Doritos <em className="font-normal italic text-primary">AI</em>
      </span>
    </Link>
  );
};

export default SidebarBrand;
