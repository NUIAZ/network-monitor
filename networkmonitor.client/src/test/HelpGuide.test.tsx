/**
 * HelpGuide: section rendering, the search filter, the no-results state, and
 * the stable section ids that make /help#<section> deep-links work.
 *
 * The page fetches nothing — its content is static data — so these tests need
 * no fetch mock, only a router for the useLocation/useNavigate hash handling.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import HelpGuide from '../Components/HelpGuide/HelpGuide';

/** Every section the guide promises, in document order. */
const SECTIONS: Array<[id: string, heading: string]> = [
  ['getting-started', 'Getting started'],
  ['dashboard', 'Dashboard'],
  ['devices', 'Devices'],
  ['device-detail', 'Device detail'],
  ['scans', 'Scans & profiles'],
  ['change-detection', 'How change detection works'],
  ['alerts', 'Alerts'],
  ['security', 'Vulnerabilities & certificates'],
  ['switches', 'Switches (SNMP)'],
  ['settings', 'Settings'],
  ['error-logs', 'Error logs'],
  ['safety', 'Safety & scope'],
  ['tips', 'Keyboard & tips'],
];

function renderHelp(route = '/help') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <HelpGuide />
    </MemoryRouter>,
  );
}

describe('HelpGuide', () => {
  it('renders every section heading', () => {
    renderHelp();
    expect(screen.getByTestId('help-page')).toBeInTheDocument();
    for (const [id, heading] of SECTIONS) {
      expect(screen.getByTestId(`help-section-${id}`)).toBeInTheDocument();
      // The title appears in the card header; the index button carries it too,
      // so scope the lookup to the section itself.
      expect(screen.getByTestId(`help-section-${id}`)).toHaveTextContent(heading);
    }
  });

  it('gives every section a stable id so /help#section deep-links resolve', () => {
    const { container } = renderHelp();
    for (const [id] of SECTIONS) {
      const element = container.querySelector(`#${id}`);
      expect(element, `missing anchor id "${id}"`).not.toBeNull();
      expect(element?.tagName).toBe('SECTION');
    }
  });

  it('filters the sections down to the ones matching the search box', async () => {
    const user = userEvent.setup();
    renderHelp();

    await user.type(screen.getByTestId('help-search'), 'saturation');

    // Link saturation is only explained in the SNMP switches section.
    expect(screen.getByTestId('help-section-switches')).toBeInTheDocument();
    expect(screen.queryByTestId('help-section-security')).not.toBeInTheDocument();
    expect(screen.queryByTestId('help-section-dashboard')).not.toBeInTheDocument();
    // Derived from the table above rather than hard-coded, so adding a section
    // does not silently break an unrelated assertion.
    expect(screen.getByTestId('help-search-meta'))
      .toHaveTextContent(`1 of ${SECTIONS.length} sections`);
  });

  it('highlights the matched text inside a surviving section', async () => {
    const user = userEvent.setup();
    const { container } = renderHelp();

    await user.type(screen.getByTestId('help-search'), 'debounce');

    const marks = container.querySelectorAll('mark.help-hit');
    expect(marks.length).toBeGreaterThan(0);
    expect(marks[0].textContent?.toLowerCase()).toBe('debounce');
  });

  it('shows an empty state for a query that matches nothing', async () => {
    const user = userEvent.setup();
    renderHelp();

    await user.type(screen.getByTestId('help-search'), 'zzzznotathing');

    expect(screen.getByTestId('help-empty')).toBeInTheDocument();
    for (const [id] of SECTIONS) {
      expect(screen.queryByTestId(`help-section-${id}`)).not.toBeInTheDocument();
    }
  });

  it('restores every section when the empty state is cleared', async () => {
    const user = userEvent.setup();
    renderHelp();

    await user.type(screen.getByTestId('help-search'), 'zzzznotathing');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));

    expect(screen.queryByTestId('help-empty')).not.toBeInTheDocument();
    expect(screen.getAllByTestId(/^help-section-/)).toHaveLength(SECTIONS.length);
  });
});
