// Opens the owner's arcade games from a cabinet click or the control page.
import { create } from 'zustand';
import { ArcadeModal } from '../arcade/ArcadeModal';
import type { GameId } from '../model/types';
import { useStore } from '../store/store';

export const useArcade = create<{ game: GameId | null; open: (g: GameId) => void; close: () => void }>((set) => ({
  game: null, open: (game) => set({ game }), close: () => set({ game: null }),
}));

export function ArcadeHost() {
  const game = useArcade((s) => s.game);
  if (!game) return null;
  return (
    <ArcadeModal
      key={game}
      game={game}
      onClose={() => useArcade.getState().close()}
      onSessionEnd={(s) => useStore.getState().runRuntimeOps([{ op: 'arcade.recordSession', game: s.game, score: s.score, durationSec: Math.round(s.durationSec), result: s.result }])}
    />
  );
}
