// Shown when the saved brain could not be loaded. Nothing is overwritten and autosave stays off
// until the user picks one of: restore the backup, download the damaged data, or start fresh.
// A copy of the damaged data has already been kept (damaged-<time>) by the repository.
import { useState } from 'react';
import { repo, useStore } from '../store/store';
import { saveFile } from '../persistence/saveFile';

export function RecoveryDialog() {
  const rec = useStore((s) => s.recovery);
  const [confirmFresh, setConfirmFresh] = useState(false);
  const [downloaded, setDownloaded] = useState<string | null>(null);
  if (!rec) return null;
  const { resolveRecovery } = useStore.getState();
  const backupAt = rec.backup ? new Date(rec.backup.savedAt).toLocaleString() : null;
  const where = repo.backendKind === 'desktop' ? `in ${repo.location}` : 'in this browser’s storage';

  const download = async () => {
    if (!rec.raw) return;
    const r = await saveFile(`damaged-brain-save-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, rec.raw);
    setDownloaded(r === 'saved' ? 'Download started.' : r === 'declined' ? 'Download cancelled.' : 'Download is unavailable here.');
  };

  return (
    <div className="overlay recovery-overlay">
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="recovery-h" aria-describedby="recovery-d">
        <div className="panel-h" id="recovery-h" style={{ color: 'var(--warn)' }}>Your saved brain could not be loaded</div>
        <div className="modal-b recovery-body" id="recovery-d">
          <p><strong>{rec.reason}</strong></p>
          <p>Nothing has been overwritten, and saving is paused until you choose what to do.</p>
          {rec.damagedName && <p className="muted">A copy of the damaged data is kept as <code>{rec.damagedName}</code> {where}.</p>}
          {rec.damagedError && <p style={{ color: 'var(--danger)' }}>{rec.damagedError}</p>}
          {rec.backup
            ? <p>A valid backup from <strong>{backupAt}</strong> is available{rec.backup.doc.name ? <> (“{rec.backup.doc.name}”)</> : null}.</p>
            : <p className="muted">{rec.backupProblem ? `The backup can’t be used either: ${rec.backupProblem}` : 'There is no backup to restore.'}</p>}
          {downloaded && <p className="muted" role="status">{downloaded}</p>}
          {confirmFresh && (
            <div className="recovery-confirm" role="group" aria-label="Confirm start fresh">
              <p>Start a fresh brain with only ORIGIN? It will be saved as your current brain{rec.backup ? ', and the backup is kept' : ''}.{rec.raw ? (rec.damagedName ? ' The copy of the damaged data stays.' : ' The damaged data could not be kept, so download it first if you want it.') : ''}</p>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn" onClick={() => setConfirmFresh(false)} autoFocus>Go back</button>
                <button className="btn danger" onClick={() => resolveRecovery('fresh')}>Yes, start fresh</button>
              </div>
            </div>
          )}
        </div>
        {!confirmFresh && (
          <div className="modal-f">
            {rec.raw && <button className="btn" onClick={download}>Download damaged save</button>}
            <button className="btn danger" onClick={() => setConfirmFresh(true)}>Start fresh…</button>
            {rec.backup && <button className="btn primary" autoFocus onClick={() => resolveRecovery('backup')} title={`Restore the backup from ${backupAt}`}>Restore backup</button>}
          </div>
        )}
      </div>
    </div>
  );
}
