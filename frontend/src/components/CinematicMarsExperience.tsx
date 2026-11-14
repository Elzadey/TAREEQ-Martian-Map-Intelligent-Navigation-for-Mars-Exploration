import {
  ChevronLeft,
  ChevronRight,
  Compass,
  Gauge,
  Globe2,
  Navigation,
  Pause,
  Play,
  Radar,
  Sparkles,
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

type Scene = {
  id: string;
  title: string;
  subtitle: string;
  coordinates: string;
  objective: string;
  summary: string;
  terrain: string;
  accent: string;
};

const CINEMATIC_SCENES: Scene[] = [
  {
    id: 'gale',
    title: 'Gale Crater',
    subtitle: 'Curiosity corridor',
    coordinates: '5.4° S, 137.8° E',
    objective: 'Inspect layered sedimentary outcrops and ridge systems.',
    summary:
      'The rover sweeps across layered terrain where ancient lakebeds and mountain front slopes reveal the sedimentary story of Mars.',
    terrain: 'Sedimentary fan / crater rim',
    accent: '#f97316',
  },
  {
    id: 'sharp',
    title: 'Mount Sharp',
    subtitle: 'A cliffside ascent',
    coordinates: '5.1° S, 137.8° E',
    objective: 'Track a climbing route across the layered Mount Sharp front.',
    summary:
      'A cinematic climb over the mountain front reveals mineral bands, sharp relief, and a series of science targets built into the valley wall.',
    terrain: 'Layered butte / foothill escarpment',
    accent: '#fb7185',
  },
  {
    id: 'gediz',
    title: 'Gediz Vallis',
    subtitle: 'Channel and ridge traverse',
    coordinates: '2.8° S, 9.5° E',
    objective: 'Follow ancient fluvial pathways and preserved ridge lines.',
    summary:
      'The route lines up with ridges and channels carved by long-ago water flows, exposing junctions where erosive forces shaped the surface.',
    terrain: 'Valley network / channel ridge',
    accent: '#38bdf8',
  },
  {
    id: 'jezero',
    title: 'Jezero Crater',
    subtitle: 'Delta landing zone',
    coordinates: '18.4° N, 77.4° E',
    objective: 'Assess river delta remnants and multi-layered geology.',
    summary:
      'Perseverance surveys a delta plain where the old lakebed and distributary channels fuse into a broad, high-interest exploration zone.',
    terrain: 'Delta fan / crater floor',
    accent: '#a78bfa',
  },
];

interface CinematicMarsExperienceProps {
  onEnterExperience?: () => void;
  onSkipIntro?: () => void;
}

const CinematicMarsExperience: React.FC<CinematicMarsExperienceProps> = ({
  onEnterExperience,
  onSkipIntro,
}) => {
  const [sceneIndex, setSceneIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);

  useEffect(() => {
    if (!isPlaying) return;

    const intervalId = window.setInterval(() => {
      setSceneIndex((current) => (current + 1) % CINEMATIC_SCENES.length);
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [isPlaying]);

  const scene = useMemo(() => CINEMATIC_SCENES[sceneIndex], [sceneIndex]);

  const goToPrevious = () => {
    setSceneIndex((current) => (current - 1 + CINEMATIC_SCENES.length) % CINEMATIC_SCENES.length);
  };

  const goToNext = () => {
    setSceneIndex((current) => (current + 1) % CINEMATIC_SCENES.length);
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#050b14] text-white">
      <div
        className="absolute inset-0 opacity-90"
        style={{
          background:
            'radial-gradient(circle at 18% 20%, rgba(251,146,60,0.26), transparent 30%), radial-gradient(circle at 75% 22%, rgba(56,189,248,0.22), transparent 28%), linear-gradient(135deg, #050b14 0%, #0d1728 34%, #141a2b 100%)',
        }}
      />

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(15,23,42,0.15),_transparent_60%)]" />

      <div className="relative z-10 flex h-full flex-col justify-between p-6 md:p-8">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 rounded-full border border-white/10 bg-slate-900/50 px-4 py-2 backdrop-blur-md">
            <Sparkles className="h-4 w-4 text-orange-300" />
            <span className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-200">
              Cinematic Mars Mission
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsPlaying((current) => !current)}
              className="inline-flex items-center gap-2 rounded-full border border-orange-400/40 bg-orange-500/10 px-3 py-2 text-sm font-medium text-orange-100 transition hover:bg-orange-500/20"
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {isPlaying ? 'Pause tour' : 'Play tour'}
            </button>
          </div>
        </header>

        <div className="grid flex-1 grid-cols-1 gap-6 py-6 lg:grid-cols-[1.35fr_0.65fr]">
          <section className="flex flex-col justify-center">
            <div className="mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.22em] text-sky-200">
              <Sparkles className="h-3.5 w-3.5" />
              Live narrative route
            </div>

            <h1 className="max-w-2xl text-4xl font-black tracking-tight text-white md:text-6xl">
              {scene.title}
            </h1>

            <p className="mt-3 text-lg font-medium text-orange-200">{scene.subtitle}</p>

            <div className="mt-6 flex flex-wrap items-center gap-4 text-sm text-slate-200">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/60 px-3 py-2">
                <Compass className="h-4 w-4 text-orange-300" />
                {scene.coordinates}
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/60 px-3 py-2">
                <Radar className="h-4 w-4 text-sky-300" />
                {scene.terrain}
              </div>
            </div>

            <p className="mt-6 max-w-xl text-base leading-8 text-slate-200 md:text-lg">
              {scene.summary}
            </p>

            <div className="mt-8 max-w-xl rounded-2xl border border-white/10 bg-slate-950/50 p-5 backdrop-blur-md">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-slate-300">
                <Gauge className="h-4 w-4 text-violet-300" />
                objective
              </div>
              <p className="text-base leading-7 text-slate-100">{scene.objective}</p>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={goToPrevious}
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10"
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </button>
              <button
                type="button"
                onClick={goToNext}
                className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-orange-500 to-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-orange-500/20 transition hover:brightness-110"
              >
                Next stop
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onEnterExperience}
                className="inline-flex items-center gap-2 rounded-full border border-orange-400/60 bg-orange-500/20 px-5 py-2.5 text-sm font-semibold uppercase tracking-[0.2em] text-orange-50 transition hover:bg-orange-500/30"
              >
                ENTER EXPERIENCE
              </button>
              {onSkipIntro && (
                <button
                  type="button"
                  onClick={onSkipIntro}
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-slate-900/60 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-800"
                >
                  Skip Intro
                </button>
              )}
            </div>
          </section>

          <aside className="flex flex-col justify-center">
            <div className="rounded-[28px] border border-white/10 bg-slate-950/45 p-5 shadow-2xl shadow-black/30 backdrop-blur-md">
              <div className="mb-4 flex items-center justify-between">
                <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-slate-300">
                  <Globe2 className="h-4 w-4 text-orange-300" />
                  Mission overview
                </div>
                <div
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: scene.accent, boxShadow: `0 0 16px ${scene.accent}` }}
                />
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Target</div>
                  <div className="mt-2 text-2xl font-bold text-white">{scene.title}</div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-3">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Terrain</div>
                    <div className="mt-2 text-sm font-semibold text-slate-100">{scene.terrain}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-3">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Mode</div>
                    <div className="mt-2 text-sm font-semibold text-slate-100">Cinematic</div>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900 to-slate-800/90 p-4">
                  <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-300">
                    <Navigation className="h-4 w-4 text-sky-300" />
                    Flight path
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm text-slate-200">
                    <span>Route confidence</span>
                    <span className="font-bold text-emerald-300">94%</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: '94%', background: `linear-gradient(90deg, ${scene.accent}, #fbbf24)` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>

        <footer className="relative z-10">
          <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-3 backdrop-blur-md">
            <div className="mb-3 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-300">
              <span>Mission sequence</span>
              <span>
                {sceneIndex + 1}/{CINEMATIC_SCENES.length}
              </span>
            </div>

            <div className="flex gap-2">
              {CINEMATIC_SCENES.map((entry, index) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setSceneIndex(index)}
                  className={`relative h-14 flex-1 overflow-hidden rounded-xl border text-left transition ${
                    index === sceneIndex
                      ? 'border-orange-400/60 bg-slate-900/80'
                      : 'border-white/10 bg-slate-900/40 hover:bg-slate-900/70'
                  }`}
                >
                  <div
                    className="absolute inset-x-0 top-0 h-1"
                    style={{ backgroundColor: entry.accent }}
                  />
                  <div className="flex h-full flex-col justify-center px-3 pt-2">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Stop {index + 1}</div>
                    <div className="mt-1 text-sm font-semibold text-white">{entry.title}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default CinematicMarsExperience;
