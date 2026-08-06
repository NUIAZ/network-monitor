/**
 * FeatureTour: step navigation, the exit paths, the missing-target escape
 * hatch, and the first-run auto-play gate.
 *
 * The component is driven with small fixture steps rather than the real
 * TOUR_STEPS, so these tests exercise the machinery and never break when the
 * walkthrough copy is rewritten. Targets are plain divs rendered beside the
 * overlay; jsdom reports zero-sized boxes for all of them, which is fine —
 * placement is arithmetic on numbers and does not care that they are zeros.
 *
 * Auto-play is suppressed under a test runner by default (see
 * isTestEnvironment), so the two tests that care about the first-run decision
 * opt back in with `autoStartEnabled` and assert on the localStorage gate.
 */
import { describe, expect, it } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import FeatureTour, { startTour } from '../Components/FeatureTour/FeatureTour';
import type { FeatureTourProps } from '../Components/FeatureTour/FeatureTour';
import { TOUR_SEEN_KEY } from '../Components/FeatureTour/tourSteps';
import type { TourStep } from '../Components/FeatureTour/tourSteps';

/** Three steps, all of whose targets exist in the harness below. */
const STEPS: TourStep[] = [
  { id: 'one', target: '[data-tour="one"]', title: 'Step one', body: 'The first thing.' },
  { id: 'two', target: '[data-tour="two"]', title: 'Step two', body: 'The second thing.' },
  { id: 'three', target: '[data-tour="three"]', title: 'Step three', body: 'The third thing.' },
];

/** Same shape, but the middle step points at something that is not rendered. */
const STEPS_WITH_MISSING_TARGET: TourStep[] = [
  STEPS[0],
  { id: 'gone', target: '[data-tour="never-rendered"]', title: 'Step gone', body: 'Nothing to see.' },
  STEPS[2],
];

/**
 * Renders the overlay plus the elements its fixture steps point at. The
 * dashboard marker is included because that is what auto-play waits for.
 */
function renderTour(props: FeatureTourProps = {}) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <div data-testid="dashboard">
        <div data-tour="one">one</div>
        <div data-tour="two">two</div>
        <div data-tour="three">three</div>
      </div>
      <FeatureTour steps={STEPS} resolveTimeoutMs={0} {...props} />
    </MemoryRouter>,
  );
}

/** Fires the exported replay entry point the way the real buttons do. */
async function replay() {
  await act(async () => {
    startTour();
  });
}

describe('FeatureTour', () => {
  it('renders the first step once the tour is started', async () => {
    renderTour();
    expect(screen.queryByTestId('feature-tour')).toBeNull();

    await replay();

    expect(screen.getByTestId('feature-tour')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByTestId('tour-callout')).toHaveTextContent('Step one');
    expect(screen.getByTestId('tour-step-count')).toHaveTextContent('1 of 3');
    // Back is meaningless on step one.
    expect(screen.getByTestId('tour-back')).toBeDisabled();
    expect(screen.getByTestId('tour-next')).toHaveTextContent('Next');
  });

  it('moves forward with Next and back with Back', async () => {
    const user = userEvent.setup();
    renderTour();
    await replay();

    await user.click(screen.getByTestId('tour-next'));
    await waitFor(() => expect(screen.getByTestId('tour-callout')).toHaveTextContent('Step two'));
    expect(screen.getByTestId('tour-step-count')).toHaveTextContent('2 of 3');
    expect(screen.getByTestId('tour-back')).toBeEnabled();

    await user.click(screen.getByTestId('tour-next'));
    await waitFor(() => expect(screen.getByTestId('tour-callout')).toHaveTextContent('Step three'));
    // Last step offers Finish rather than a Next that goes nowhere.
    expect(screen.getByTestId('tour-next')).toHaveTextContent('Finish');

    await user.click(screen.getByTestId('tour-back'));
    await waitFor(() => expect(screen.getByTestId('tour-callout')).toHaveTextContent('Step two'));
    expect(screen.getByTestId('tour-step-count')).toHaveTextContent('2 of 3');
  });

  it('closes on Skip and records that the tour has been seen', async () => {
    const user = userEvent.setup();
    renderTour();
    await replay();
    expect(localStorage.getItem(TOUR_SEEN_KEY)).toBeNull();

    await user.click(screen.getByTestId('tour-skip'));

    await waitFor(() => expect(screen.queryByTestId('feature-tour')).toBeNull());
    expect(localStorage.getItem(TOUR_SEEN_KEY)).not.toBeNull();
  });

  it('skips a step whose target is missing instead of hanging on it', async () => {
    const user = userEvent.setup();
    renderTour({ steps: STEPS_WITH_MISSING_TARGET });
    await replay();
    expect(screen.getByTestId('tour-callout')).toHaveTextContent('Step one');

    await user.click(screen.getByTestId('tour-next'));

    // Step two's target never renders, so the tour walks straight past it in
    // the direction of travel rather than parking on an empty spotlight.
    await waitFor(() => expect(screen.getByTestId('tour-callout')).toHaveTextContent('Step three'));
    expect(screen.getByTestId('tour-callout')).not.toHaveTextContent('Step gone');
    expect(screen.getByTestId('tour-step-count')).toHaveTextContent('3 of 3');
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    renderTour();
    await replay();
    expect(screen.getByTestId('feature-tour')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByTestId('feature-tour')).toBeNull());
    expect(localStorage.getItem(TOUR_SEEN_KEY)).not.toBeNull();
  });

  it('advances with ArrowRight and returns with ArrowLeft', async () => {
    const user = userEvent.setup();
    renderTour();
    await replay();

    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(screen.getByTestId('tour-callout')).toHaveTextContent('Step two'));

    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(screen.getByTestId('tour-callout')).toHaveTextContent('Step one'));
  });

  it('auto-plays on a first visit once the dashboard has rendered', async () => {
    renderTour({ autoStartEnabled: true });

    await waitFor(() => expect(screen.getByTestId('tour-callout')).toHaveTextContent('Step one'));
  });

  it('does not auto-play when the seen key is already set', async () => {
    localStorage.setItem(TOUR_SEEN_KEY, new Date().toISOString());

    renderTour({ autoStartEnabled: true });

    // Give the auto-start poller several intervals to misbehave in.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(screen.queryByTestId('feature-tour')).toBeNull();

    // …but the replay buttons still work, which is the whole point of the gate.
    await replay();
    expect(screen.getByTestId('tour-callout')).toHaveTextContent('Step one');
  });
});
