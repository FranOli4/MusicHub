import { useEffect, useState } from 'react';
import type { Space } from '../recipes/schema';
import { AddSong } from './AddSong';
import { Toasts } from './common';
import { enterSpace, getLastSpace, setLastSpace, usePlayer } from './controller';
import { Favourites } from './Favourites';
import { BackIcon, GearIcon, HeartIcon, MoonIcon, NoteIcon, PlusIcon, SunIcon } from './icons';
import { NowPlaying } from './NowPlaying';
import { Settings } from './Settings';

type Tab = 'now' | 'favourites' | 'add' | 'settings';

export function App() {
  const [space, setSpace] = useState<Space | null>(getLastSpace);
  const [tab, setTab] = useState<Tab>('now');

  useEffect(() => {
    document.documentElement.dataset.space = space ?? 'home';
    const theme = space === 'think' ? '#17130e' : space === 'sleep' ? '#090d18' : '#0e1220';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme);
  }, [space]);

  const open = (s: Space) => {
    setSpace(s);
    setTab('now');
    void enterSpace(s);
  };

  if (!space) return (<><Home onOpen={open} /><Toasts /></>);

  const other: Space = space === 'think' ? 'sleep' : 'think';
  return (
    <div className="shell">
      <header className="top">
        <button className="icon-btn" onClick={() => (setSpace(null), setLastSpace(null))} aria-label="Back to home">
          <BackIcon />
        </button>
        <div className="top-title">
          {space === 'sleep' ? <MoonIcon /> : <SunIcon />}
          <span>{space === 'sleep' ? 'Sleep' : 'Think'}</span>
        </div>
        <button className="btn ghost small" onClick={() => open(other)}>
          {other === 'sleep' ? 'Sleep' : 'Think'} →
        </button>
      </header>

      <main className="content">
        {tab === 'now' && <NowPlaying space={space} />}
        {tab === 'favourites' && <Favourites space={space} />}
        {tab === 'add' && <AddSong space={space} onAdded={() => setTab('favourites')} />}
        {tab === 'settings' && <Settings space={space} />}
      </main>

      <nav className="tabs" aria-label="Sections">
        <TabButton active={tab === 'now'} onClick={() => setTab('now')} icon={<NoteIcon />} label="Playing" />
        <TabButton active={tab === 'favourites'} onClick={() => setTab('favourites')} icon={<HeartIcon />} label="Favourites" />
        <TabButton active={tab === 'add'} onClick={() => setTab('add')} icon={<PlusIcon />} label="Add song" />
        <TabButton active={tab === 'settings'} onClick={() => setTab('settings')} icon={<GearIcon />} label="Settings" />
      </nav>
      <Toasts />
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button className={`tab ${active ? 'on' : ''}`} onClick={onClick} aria-current={active ? 'page' : undefined}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function Home({ onOpen }: { onOpen: (s: Space) => void }) {
  const { status, current } = usePlayer();
  const playingIn = status === 'playing' ? current?.space : null;
  return (
    <div className="home">
      <div className="home-head">
        <h1>MusicHub</h1>
        <p>Worship and classical music that never ends</p>
      </div>
      <button className="space-tile think" onClick={() => onOpen('think')}>
        <SunIcon width={36} height={36} />
        <span className="tile-name">Think</span>
        <span className="tile-hint">Focus music: worship piano and classical</span>
        {playingIn === 'think' && <span className="tile-live">Playing</span>}
      </button>
      <button className="space-tile sleep" onClick={() => onOpen('sleep')}>
        <MoonIcon width={36} height={36} />
        <span className="tile-name">Sleep</span>
        <span className="tile-hint">Slow, soft music to rest and fall asleep</span>
        {playingIn === 'sleep' && <span className="tile-live">Playing</span>}
      </button>
    </div>
  );
}
