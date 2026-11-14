import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import IntegratedMarsExplorer from '../components/IntegratedMarsExplorer';
import { getPlanningGridCoordinates, planRoutesLocal } from '../features/route-planning/algorithms';

jest.mock('../features/mars-mapping/components/OpenLayersMarsMapper', () => () => <div data-testid="mars-2d-map" />);
jest.mock('../views/Mars3DViewer', () => (props: { missionMode?: boolean }) => (
  <div data-testid={props.missionMode ? 'mars-rover-mission' : 'mars-3d-globe'} />
));

describe('IntegratedMarsExplorer navigation', () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('shows the intro message and TAREEQ title, then opens the normal 3D view with exactly three experiences', () => {
    render(<IntegratedMarsExplorer initialView="map" />);

    expect(screen.getByText(/EXPLORE OUR PLATFORM/)).toBeInTheDocument();
    const navigation = screen.getByRole('navigation', { name: 'Main experiences' });
    expect(within(navigation).getAllByRole('button')).toHaveLength(3);

    act(() => {
      jest.advanceTimersByTime(1700);
    });
    expect(screen.getByText('TAREEQ')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1500);
    });
    expect(screen.queryByText('DISCOVER THE MARTIAN WORLD')).not.toBeInTheDocument();
    expect(screen.getByTestId('mars-3d-globe')).toBeInTheDocument();
  });

  it('switches directly between the 3D globe and mission setup', () => {
    render(<IntegratedMarsExplorer initialView="map" />);
    act(() => {
      jest.advanceTimersByTime(3200);
    });

    fireEvent.click(screen.getByRole('button', { name: '3D VIEW' }));
    expect(screen.getByTestId('mars-3d-globe')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'START MISSION' }));
    expect(screen.getByTestId('mars-2d-map')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('does not report fabricated slope or hazard metrics when no DEM is configured', () => {
    const start: [number, number] = [0, 0];
    const destination: [number, number] = [0.2, 0.2];
    const routePlan = planRoutesLocal(start, destination);
    const selected = routePlan.routes.find((route) => route.path);

    expect(routePlan.terrain).toBe('No DEM configured');
    expect(selected?.path?.[0]).toEqual(start);
    expect(selected?.path?.[selected.path.length - 1]).toEqual(destination);
    expect(selected?.max_slope_deg).toBeUndefined();
    expect(selected?.risk_score).toBeUndefined();

    const coordinates = getPlanningGridCoordinates(start, destination);
    const demSamples = new Float64Array(coordinates.length).fill(125);
    const demPlan = planRoutesLocal(start, destination, demSamples);
    expect(demPlan.terrain).toBe('Configured Mars DEM');
  });

  it('shows that A* and UCS search differently even when no DEM gives them the same optimal distance', () => {
    const plan = planRoutesLocal([-133.8, 18.65], [-59, -14]);
    const astar = plan.routes.find((route) => route.id === 'astar');
    const ucs = plan.routes.find((route) => route.id === 'ucs');

    expect(plan.terrain).toBe('No DEM configured');
    expect(astar?.length_km).toBe(ucs?.length_km);
    expect(ucs?.nodes_expanded).toBeGreaterThan(astar?.nodes_expanded ?? 0);
  });
});
