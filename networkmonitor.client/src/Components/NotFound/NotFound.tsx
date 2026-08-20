/**
 * 404 catch-all route.
 */
import { Link } from 'react-router-dom';
import EmptyState from '../Shared/EmptyState';

/**
 * Reached only through the router's `*` route, so it renders inside the shell
 * with the sidebar intact: a mistyped URL should leave navigation working
 * rather than dropping the reader onto a bare page.
 */
export default function NotFound() {
  return (
    <EmptyState icon="bi-signpost-split" title="Page not found" message="That address doesn't map to anything here.">
      <Link to="/" className="btn btn-accent">
        <i className="bi bi-speedometer2 me-1" />
        Back to dashboard
      </Link>
    </EmptyState>
  );
}
