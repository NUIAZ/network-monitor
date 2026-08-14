/**
 * FeatureTour: the spotlight walkthrough a first-time visitor gets exactly once.
 *
 * This is a public showcase repo, so the first ninety seconds matter more than
 * anything else in the UI. The tour dims the page, rings one element at a time,
 * and explains it — content lives in tourSteps.ts, this file is only the
 * machinery.
 *
 * Three design decisions worth knowing about:
 *
 * 1. **A missing target skips the step, it never stalls.** Steps can point at
 *    elements on lazily-loaded routes, at panels that only render when data
 *    exists, or at chrome that a narrow viewport hides. Every step therefore
 *    gets a short grace period to appear; if it does not, the tour keeps
 *    travelling in whichever direction the reader was going. A tour that
 *    freezes on a blank spotlight is the failure mode that makes the whole
 *    feature feel broken, and it is far worse than a step nobody saw.
 *
 * 2. **`startTour()` is a module-level function, not context.** The two replay
 *    entry points sit in different trees — the top bar is in the shell, the
 *    help page is lazily loaded — and a tiny subscriber set is less plumbing
 *    than a provider that would have to wrap both.
 *
 * 3. **The scrim is derived from `--sidebar-bg-end`.** A scrim must read as
 *    "dimmed" in every theme, and that is the one token guaranteed to be dark
 *    in all eight (light themes keep a dark sidebar). Deriving the wash from
 *    `--bg-primary` would tint it near-white in the light themes.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { TOUR_SEEN_KEY, TOUR_STEPS } from './tourSteps';
import type { TourPlacement, TourStep } from './tourSteps';
import './FeatureTour.css';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Breathing room between the target's box and the spotlight ring, in px. */
const SPOTLIGHT_PADDING = 8;
/** Gap between the spotlight ring and the callout card, in px. */
const CALLOUT_GAP = 14;
/** Closest the callout is allowed to sit to a viewport edge, in px. */
const VIEWPORT_MARGIN = 12;
/** Re-check interval while waiting for a step's target to appear. */
const POLL_INTERVAL_MS = 60;
/** Grace period for a step target before the step is skipped. */
const DEFAULT_RESOLVE_TIMEOUT_MS = 2500;
/** How long auto-start waits for the dashboard before giving up entirely. */
const DEFAULT_AUTOSTART_TIMEOUT_MS = 8000;
/**
 * Presence of this element means the dashboard rendered its *content* rather
 * than its loading spinner — auto-starting any earlier lands the very first
 * spotlight on a skeleton.
 */
const DASHBOARD_READY_SELECTOR = '[data-testid="dashboard"]';

// ---------------------------------------------------------------------------
// Replay entry points
// ---------------------------------------------------------------------------

type StartListener = () => void;

/** Mounted FeatureTour instances. Realistically always zero or one. */
const startListeners = new Set<StartListener>();

/**
 * Starts (or restarts) the tour from step one. Exported so any component can
 * offer a replay button without knowing where the overlay is mounted; a no-op
 * when no FeatureTour is mounted, which is the correct behaviour rather than
 * an error.
 */
export function startTour(): void {
  for (const listener of startListeners) listener();
}

// ---------------------------------------------------------------------------
// First-run gate
// ---------------------------------------------------------------------------

/**
 * True once the visitor has finished *or* dismissed the tour. Storage access is
 * wrapped because private windows and embedded webviews can throw on it, and
 * "we could not read the flag" should mean "show the tour", not "crash".
 */
export function hasSeenTour(): boolean {
  try {
    return localStorage.getItem(TOUR_SEEN_KEY) !== null;
  } catch {
    // No storage means no memory between visits; auto-playing every time is
    // still better than never playing at all.
    return false;
  }
}

/** Records that the tour has been seen. Skipping counts — see hasSeenTour. */
export function markTourSeen(): void {
  try {
    localStorage.setItem(TOUR_SEEN_KEY, new Date().toISOString());
  } catch {
    // Best effort; the session still gets a tour that closes when asked.
  }
}

/**
 * Vitest runs with MODE "test"; a browser build is "development" or
 * "production". Auto-playing under a test runner would make every unrelated
 * component test race an overlay it never asked for.
 */
export function isTestEnvironment(): boolean {
  return import.meta.env.MODE === 'test';
}

/** Honours the OS "reduce motion" setting; jsdom has no matchMedia. */
function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Viewport-relative box of a spotlight target. */
export interface SpotRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface Size {
  width: number;
  height: number;
}

/** Where the callout ends up, and which side it settled on. */
export interface CalloutPosition {
  top: number;
  left: number;
  placement: TourPlacement | 'center';
}

function readRect(element: Element): SpotRect {
  const box = element.getBoundingClientRect();
  return { top: box.top, left: box.left, width: box.width, height: box.height };
}

function clamp(value: number, min: number, max: number): number {
  // max can fall below min on a very small viewport; min wins so the card stays
  // reachable rather than being pushed off the top-left corner.
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

/**
 * Places the callout beside the target, flipping to another side when the
 * preferred one would overflow the viewport.
 *
 * Pure and exported so the placement rules can be reasoned about (and tested)
 * without a DOM: given a target box, a card size, and a viewport, there is one
 * right answer.
 */
export function placeCallout(
  target: SpotRect | null,
  callout: Size,
  viewport: Size,
  preferred: TourPlacement,
): CalloutPosition {
  // No target (still resolving), or a viewport too small to put a card beside
  // anything: fall back to a centered card, which is always readable.
  const tooSmall =
    viewport.width < callout.width + 2 * VIEWPORT_MARGIN ||
    viewport.height < callout.height + 2 * VIEWPORT_MARGIN;

  if (target === null || tooSmall) {
    return {
      top: Math.max(VIEWPORT_MARGIN, (viewport.height - callout.height) / 2),
      left: Math.max(VIEWPORT_MARGIN, (viewport.width - callout.width) / 2),
      placement: 'center',
    };
  }

  const offset = SPOTLIGHT_PADDING + CALLOUT_GAP;
  const maxLeft = viewport.width - callout.width - VIEWPORT_MARGIN;
  const maxTop = viewport.height - callout.height - VIEWPORT_MARGIN;

  const candidate = (placement: TourPlacement): CalloutPosition => {
    switch (placement) {
      case 'bottom':
        return {
          top: target.top + target.height + offset,
          left: clamp(target.left + target.width / 2 - callout.width / 2, VIEWPORT_MARGIN, maxLeft),
          placement,
        };
      case 'top':
        return {
          top: target.top - offset - callout.height,
          left: clamp(target.left + target.width / 2 - callout.width / 2, VIEWPORT_MARGIN, maxLeft),
          placement,
        };
      case 'right':
        return {
          top: clamp(target.top + target.height / 2 - callout.height / 2, VIEWPORT_MARGIN, maxTop),
          left: target.left + target.width + offset,
          placement,
        };
      case 'left':
        return {
          top: clamp(target.top + target.height / 2 - callout.height / 2, VIEWPORT_MARGIN, maxTop),
          left: target.left - offset - callout.width,
          placement,
        };
    }
  };

  const fits = (position: CalloutPosition): boolean =>
    position.top >= VIEWPORT_MARGIN &&
    position.left >= VIEWPORT_MARGIN &&
    position.top + callout.height <= viewport.height - VIEWPORT_MARGIN &&
    position.left + callout.width <= viewport.width - VIEWPORT_MARGIN;

  // Preferred side first, then its opposite (the natural flip), then the other
  // axis. The first side that fits without clipping wins.
  const opposite: Record<TourPlacement, TourPlacement> = {
    top: 'bottom',
    bottom: 'top',
    left: 'right',
    right: 'left',
  };
  const order: TourPlacement[] = [preferred, opposite[preferred], 'bottom', 'top', 'right', 'left'];

  for (const placement of order) {
    const position = candidate(placement);
    if (fits(position)) return position;
  }

  // Nothing fit cleanly — keep the preferred side but pull the card fully into
  // view. Overlapping the target beats hanging off the edge of the screen.
  const fallback = candidate(preferred);
  return {
    top: clamp(fallback.top, VIEWPORT_MARGIN, maxTop),
    left: clamp(fallback.left, VIEWPORT_MARGIN, maxLeft),
    placement: fallback.placement,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Every prop is a test seam. The app mounts this with no props at all, and the
 * defaults are the real behaviour — nothing in the UI configures a tour.
 */
export interface FeatureTourProps {
  /** Step list. Overridable so tests can drive small, purpose-built fixtures. */
  steps?: TourStep[];
  /** Grace period for a step target before the step is skipped. */
  resolveTimeoutMs?: number;
  /**
   * Overrides the "never auto-play under a test runner" guard. Tests that need
   * to exercise the first-run decision itself pass `true`; nothing in the app
   * passes it at all.
   */
  autoStartEnabled?: boolean;
  /** How long auto-start waits for the dashboard to render its content. */
  autoStartTimeoutMs?: number;
}

/**
 * Renders null unless a tour is running, so it costs nothing to leave mounted —
 * which it must be, since startTour() only reaches mounted instances. Mount it
 * once, inside the router (it navigates between steps) and outside the routed
 * pages (a step that changes route would otherwise unmount the tour driving it).
 */
export default function FeatureTour({
  steps = TOUR_STEPS,
  resolveTimeoutMs = DEFAULT_RESOLVE_TIMEOUT_MS,
  autoStartEnabled,
  autoStartTimeoutMs = DEFAULT_AUTOSTART_TIMEOUT_MS,
}: FeatureTourProps) {
  const location = useLocation();
  const navigate = useNavigate();

  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<SpotRect | null>(null);
  const [position, setPosition] = useState<CalloutPosition>({ top: 0, left: 0, placement: 'center' });

  /** Which way the reader is travelling — decides where a skipped step lands. */
  const directionRef = useRef<1 | -1>(1);
  /** The element the current step resolved to, kept for re-measuring. */
  const targetRef = useRef<Element | null>(null);
  /** Focus is restored here on exit, per the dialog contract. */
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const calloutRef = useRef<HTMLDivElement>(null);

  const step: TourStep | undefined = active ? steps[index] : undefined;

  const endTour = useCallback(() => {
    setActive(false);
    setRect(null);
    targetRef.current = null;
    // Dismissing counts as seen: a visitor who skipped does not want it back
    // on the next page load, and both replay buttons are always available.
    markTourSeen();
  }, []);

  const begin = useCallback(() => {
    directionRef.current = 1;
    targetRef.current = null;
    setRect(null);
    setIndex(0);
    setActive(true);
  }, []);

  const advance = useCallback((delta: 1 | -1) => {
    directionRef.current = delta;
    targetRef.current = null;
    setRect(null);
    setIndex((current) => current + delta);
  }, []);

  // ---- replay wiring ----------------------------------------------------
  useEffect(() => {
    startListeners.add(begin);
    return () => {
      startListeners.delete(begin);
    };
  }, [begin]);

  // ---- step resolution --------------------------------------------------
  // Navigates to the step's route if needed, then waits for its target to
  // exist before showing anything. Re-runs on pathname changes because that is
  // how the navigation half completes.
  useEffect(() => {
    if (!active) return;

    const current = steps[index];
    // Walked off either end (including "Next" on the last step) — that is a
    // finished tour.
    if (!current) {
      endTour();
      return;
    }

    if (current.route !== undefined && current.route !== location.pathname) {
      navigate(current.route);
      return;
    }

    let cancelled = false;
    let timer = 0;
    const deadline = Date.now() + resolveTimeoutMs;

    const attempt = () => {
      if (cancelled) return;

      const element = document.querySelector(current.target);
      if (element !== null) {
        targetRef.current = element;
        element.scrollIntoView?.({
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
          block: 'center',
          inline: 'nearest',
        });
        setRect(readRect(element));
        return;
      }

      if (Date.now() >= deadline) {
        // Gone for good: keep moving instead of holding the reader on an empty
        // spotlight. See the file header.
        const next = index + directionRef.current;
        if (next < 0 || next >= steps.length) endTour();
        else setIndex(next);
        return;
      }

      timer = window.setTimeout(attempt, POLL_INTERVAL_MS);
    };

    attempt();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active, index, location.pathname, steps, resolveTimeoutMs, navigate, endTour]);

  // ---- keep the spotlight glued to the target ---------------------------
  const measure = useCallback(() => {
    const element = targetRef.current;
    if (element === null) return;
    // A target that was unmounted under us (a re-render, a data reload) drops
    // the ring rather than leaving it stranded over empty page.
    if (!element.isConnected) {
      targetRef.current = null;
      setRect(null);
      return;
    }
    setRect(readRect(element));
  }, []);

  useEffect(() => {
    if (!active) return;
    window.addEventListener('resize', measure);
    // Capture phase: scrolling usually happens in an inner container, and those
    // events do not bubble to window.
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [active, measure]);

  // ---- callout placement ------------------------------------------------
  // Layout effect so the card is positioned before paint; the functional
  // setState returns the previous object when nothing moved, which is what
  // stops "measure → setState → re-measure" from looping forever.
  useLayoutEffect(() => {
    if (!active) return;
    const node = calloutRef.current;
    if (node === null) return;

    const next = placeCallout(
      rect,
      { width: node.offsetWidth, height: node.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      step?.placement ?? 'bottom',
    );

    setPosition((previous) =>
      previous.top === next.top && previous.left === next.left && previous.placement === next.placement
        ? previous
        : next,
    );
  }, [active, rect, step?.placement]);

  // ---- focus ------------------------------------------------------------
  useEffect(() => {
    if (!active) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    return () => {
      restoreFocusRef.current?.focus?.();
      restoreFocusRef.current = null;
    };
  }, [active]);

  // Pull focus to the card on every step so the keyboard shortcuts below reach
  // the tour rather than whatever was focused on the page underneath.
  useEffect(() => {
    if (!active) return;
    calloutRef.current?.focus();
  }, [active, index]);

  // ---- keyboard ---------------------------------------------------------
  useEffect(() => {
    if (!active) return;

    const trapTab = (event: KeyboardEvent) => {
      const root = calloutRef.current;
      if (root === null) return;
      const focusable = Array.from(root.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      // The card itself is focusable (tabIndex -1) and is where focus starts,
      // so it counts as "before the first control" in both directions.
      if (event.shiftKey && (activeElement === first || activeElement === root)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || activeElement === root)) {
        event.preventDefault();
        first.focus();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          endTour();
          return;
        case 'ArrowRight':
          event.preventDefault();
          advance(1);
          return;
        case 'ArrowLeft':
          event.preventDefault();
          if (index > 0) advance(-1);
          return;
        case 'Enter': {
          // A focused button is already an Enter target; handling it here too
          // would advance two steps on one keypress.
          const target = event.target as HTMLElement | null;
          if (target?.tagName === 'BUTTON') return;
          event.preventDefault();
          advance(1);
          return;
        }
        case 'Tab':
          trapTab(event);
          return;
        default:
          return;
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active, index, advance, endTour]);

  // ---- first-run auto-play ----------------------------------------------
  // Mount-only on purpose: the decision is about how the visitor *arrived*.
  // Re-arming it on later navigations would ambush someone mid-task.
  const autoStartAllowed = autoStartEnabled ?? !isTestEnvironment();
  const entryPathname = useRef(location.pathname).current;

  useEffect(() => {
    if (!autoStartAllowed) return;
    if (hasSeenTour()) return;
    // A deep link means the visitor knows where they are going; the tour is for
    // people who landed on the front door.
    if (entryPathname !== '/') return;

    let cancelled = false;
    let timer = 0;
    const deadline = Date.now() + autoStartTimeoutMs;

    const attempt = () => {
      if (cancelled) return;
      if (document.querySelector(DASHBOARD_READY_SELECTOR) !== null) {
        begin();
        return;
      }
      // The dashboard never arrived (offline API, a crash caught by the error
      // boundary). Staying quiet is better than spotlighting an error banner.
      if (Date.now() >= deadline) return;
      timer = window.setTimeout(attempt, POLL_INTERVAL_MS);
    };

    attempt();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [autoStartAllowed, autoStartTimeoutMs, entryPathname, begin]);

  // ---- render -----------------------------------------------------------
  const pips = useMemo(() => steps.map((s) => s.id), [steps]);

  if (!active || step === undefined) return null;

  const isLast = index === steps.length - 1;
  const titleId = `tour-title-${step.id}`;

  return (
    <div
      className={`tour-overlay${rect === null ? '' : ' has-spotlight'}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="feature-tour"
    >
      {/* Swallows clicks on the page beneath so a stray click cannot navigate
          out from under the tour. Dim when there is no ring to dim for us. */}
      <div className="tour-scrim" />

      {rect !== null && (
        <div
          className="tour-spotlight"
          data-testid="tour-spotlight"
          style={{
            top: rect.top - SPOTLIGHT_PADDING,
            left: rect.left - SPOTLIGHT_PADDING,
            width: rect.width + SPOTLIGHT_PADDING * 2,
            height: rect.height + SPOTLIGHT_PADDING * 2,
          }}
        />
      )}

      <div
        ref={calloutRef}
        className={`tour-callout tour-place-${position.placement}`}
        style={{ top: position.top, left: position.left }}
        tabIndex={-1}
        aria-live="polite"
        data-testid="tour-callout"
      >
        <div className="tour-meta">
          <span className="tour-count" data-testid="tour-step-count">
            {index + 1} of {steps.length}
          </span>
          <button
            type="button"
            className="tour-skip"
            onClick={endTour}
            data-testid="tour-skip"
          >
            Skip
          </button>
        </div>

        <h2 className="tour-title" id={titleId}>
          {step.title}
        </h2>
        <p className="tour-body">{step.body}</p>

        <div className="tour-pips" aria-hidden="true">
          {pips.map((id, i) => (
            <span key={id} className={`tour-pip${i === index ? ' current' : ''}${i < index ? ' done' : ''}`} />
          ))}
        </div>

        <div className="tour-actions">
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => advance(-1)}
            disabled={index === 0}
            data-testid="tour-back"
          >
            Back
          </button>
          <button
            type="button"
            className="btn btn-sm btn-accent"
            onClick={() => (isLast ? endTour() : advance(1))}
            data-testid="tour-next"
          >
            {isLast ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
