import React, { useEffect, useState } from 'react';
import OpenLayersMarsMapper from '../features/mars-mapping/components/OpenLayersMarsMapper';
import { requestMissionStart } from '../features/route-planning/missionBus';
import { subscribeToMissionRouteState, type MissionRouteState } from '../features/route-planning/routeOverlayBus';
import Mars3DViewer from '../views/Mars3DViewer';

type Experience = 'map' | 'globe' | 'setup' | 'mission';
type IntroPhase = 'message' | 'title';

interface IntegratedMarsExplorerProps {
  className?: string;
  initialView?: Experience;
}

const IntegratedMarsExplorer: React.FC<IntegratedMarsExplorerProps> = ({ className = '', initialView = 'map' }) => {
  const [experience, setExperience] = useState<Experience>(initialView);
  const [introVisible, setIntroVisible] = useState(true);
  const [introPhase, setIntroPhase] = useState<IntroPhase>('message');
  const [route, setRoute] = useState<MissionRouteState | null>(null);

  useEffect(() => {
    const titleTimer = window.setTimeout(() => setIntroPhase('title'), 1700);
    const exitTimer = window.setTimeout(() => {
      setIntroVisible(false);
      setExperience('globe');
    }, 3200);
    return () => {
      window.clearTimeout(titleTimer);
      window.clearTimeout(exitTimer);
    };
  }, []);

  useEffect(() => subscribeToMissionRouteState(setRoute), []);

  useEffect(() => {
    if (experience !== 'setup') return;
    const timer = window.setTimeout(requestMissionStart, 0);
    return () => window.clearTimeout(timer);
  }, [experience]);

  const openMissionSetup = () => setExperience('setup');
  const launchMission = () => {
    if (route?.path.length) setExperience('mission');
  };

  return (
    <main className={`relative h-screen w-full overflow-hidden bg-[#08090b] text-white ${className}`}>
      <section className="absolute inset-0">
        {experience === 'map' && <OpenLayersMarsMapper />}
        {experience === 'globe' && <Mars3DViewer />}
        {experience === 'setup' && (
          <>
            <OpenLayersMarsMapper missionPlanningMode />
            <button
              type="button"
              onClick={() => setExperience('map')}
              className="absolute bottom-5 left-5 z-40 rounded-full border border-white/15 bg-[#111317]/90 px-4 py-2 text-sm text-white/90 backdrop-blur hover:bg-[#202329]"
            >
              Cancel
            </button>
            {route?.path.length ? (
              <div className="absolute bottom-5 right-5 z-40 w-80 max-w-[calc(100%-2.5rem)] rounded-2xl border border-white/10 bg-[#111317]/95 p-4 shadow-xl backdrop-blur">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-white/50">Route ready</div>
                    <div className="mt-1 truncate text-sm font-medium">{route.algorithm}</div>
                  </div>
                  <div className="text-sm text-white/75">
                    {route.distanceKm == null ? '—' : `${route.distanceKm.toFixed(1)} km`}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={launchMission}
                  className="mt-3 w-full rounded-full bg-gradient-to-r from-[#9d3e12] via-[#cc5500] to-[#e87524] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
                >
                  START MISSION
                </button>
                <p className="mt-2 text-center text-[10px] text-white/40">
                  {route.terrainSource || 'Loading Mars elevation data'} · NASA imagery is separate from numeric terrain
                </p>
              </div>
            ) : null}
          </>
        )}
        {experience === 'mission' && (
          <Mars3DViewer missionMode onExitMission={openMissionSetup} />
        )}
      </section>

      <nav
        aria-label="Main experiences"
        className={`absolute left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-[#08090b]/80 p-1.5 shadow-lg backdrop-blur-md transition-opacity duration-500 ${experience === 'map' || experience === 'setup' ? 'top-20' : 'top-4'} ${introVisible ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
      >
        <button
          type="button"
          aria-current={experience === 'map' ? 'page' : undefined}
          onClick={() => setExperience('map')}
          className={`rounded-full px-4 py-2 text-xs font-semibold tracking-[0.12em] transition ${experience === 'map' ? 'bg-white/15 text-white' : 'text-white/65 hover:text-white'}`}
        >
          2D MAP
        </button>
        <button
          type="button"
          aria-current={experience === 'globe' ? 'page' : undefined}
          onClick={() => setExperience('globe')}
          className={`rounded-full px-4 py-2 text-xs font-semibold tracking-[0.12em] transition ${experience === 'globe' ? 'bg-white/15 text-white' : 'text-white/65 hover:text-white'}`}
        >
          3D VIEW
        </button>
        <button
          type="button"
          aria-current={experience === 'setup' || experience === 'mission' ? 'page' : undefined}
          onClick={openMissionSetup}
          className={`rounded-full px-4 py-2 text-xs font-semibold tracking-[0.12em] transition ${experience === 'setup' || experience === 'mission' ? 'bg-gradient-to-r from-[#9d3e12] via-[#cc5500] to-[#e87524] text-white' : 'text-white/65 hover:text-white'}`}
        >
          START MISSION
        </button>
      </nav>

      {introVisible && (
        <div className="mars-intro absolute inset-0 z-[100] flex items-center justify-center bg-black">
          <div className="mars-intro-orbit" aria-hidden="true" />
          {introPhase === 'message' ? (
            <p className="mars-intro-copy flex flex-col gap-3 px-6 text-center text-xs font-semibold uppercase tracking-[0.28em] text-white/85 sm:text-sm">
              <span>EXPLORE OUR PLATFORM</span>
              <span className="text-[#e87524]">YOUR GUIDE TO SAFER MARTIAN ROUTES</span>
            </p>
          ) : (
            <p className="mars-intro-title px-6 text-center text-3xl font-semibold uppercase tracking-[0.42em] text-[#e87524] sm:text-5xl">
              TAREEQ
            </p>
          )}
        </div>
      )}

      {!introVisible && experience === 'globe' && (
        <button
          type="button"
          onClick={openMissionSetup}
          className="absolute bottom-7 left-1/2 z-40 -translate-x-1/2 rounded-full bg-gradient-to-r from-[#9d3e12] via-[#cc5500] to-[#e87524] px-7 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-white shadow-xl transition hover:brightness-110"
        >
          START A MISSION
        </button>
      )}
    </main>
  );
};

export default IntegratedMarsExplorer;
