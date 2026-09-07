import React, { useEffect } from 'react';
import { useStore } from './store/useStore.js';
import IntroScreen from './components/IntroScreen.jsx';
import Header from './components/Header.jsx';
import Viewport from './components/Viewport.jsx';
import Timeline from './components/Timeline.jsx';
import Inspector from './components/Inspector.jsx';
import SystemAlert from './components/SystemAlert.jsx';
import CaptureStage from './components/CaptureStage.jsx';
import PromptScreen from './components/PromptScreen.jsx';
import RenderScreen from './components/RenderScreen.jsx';

function Shortcuts() {
  const screen = useStore((s) => s.screen);

  useEffect(() => {
    // Le transport n'a de sens que sur l'ecran de blocking.
    if (screen !== 'blocking') return undefined;
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;

      const { togglePlay, stepFrames, setTime, toggleLoop, setViewMode, viewMode } = useStore.getState();
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          stepFrames(e.shiftKey ? -10 : -1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          stepFrames(e.shiftKey ? 10 : 1);
          break;
        case 'Home':
          e.preventDefault();
          setTime(0);
          break;
        case 'KeyL':
          toggleLoop();
          break;
        case 'KeyV': {
          // Fait le tour des trois vues, dont le plan que l'ancien raccourci sautait.
          const order = ['director', 'plan', 'orbit'];
          setViewMode(order[(order.indexOf(viewMode) + 1) % order.length]);
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen]);

  return null;
}

/** Ecran 1 : le blocking. Viewport, timeline, inspecteur. */
function BlockingScreen() {
  return (
    <>
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <Viewport />
          <div className="pointer-events-none absolute right-4 top-4 z-10">
            <SystemAlert />
          </div>
        </div>
        <Inspector />
      </div>
      <div className="h-48 shrink-0 border-t border-ink-600">
        <Timeline />
      </div>
    </>
  );
}

export default function App() {
  const screen = useStore((s) => s.screen);
  const scene = useStore((s) => s.scene);
  const capture = useStore((s) => s.capture);

  if (screen === 'home' || !scene) return <IntroScreen />;

  return (
    <div className="flex h-full min-w-0 flex-col bg-ink-900">
      <Shortcuts />
      <Header />
      {screen === 'blocking' && <BlockingScreen />}
      {screen === 'prompt' && (
        <div className="min-h-0 flex-1">
          <PromptScreen />
        </div>
      )}
      {screen === 'render' && (
        <div className="min-h-0 flex-1">
          <RenderScreen />
        </div>
      )}
      {capture && <CaptureStage />}
    </div>
  );
}
