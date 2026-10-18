// Offer a generated file to the user. Inside a claude.ai artifact the page
// can't download directly, so it goes through the viewer's `downloads`
// capability; in a normal browser tab it uses a regular download link.
type Downloads = { save(req: { filename: string; data: string | Blob }): Promise<unknown> };
type ClaudeHost = { use(name: string): Promise<unknown> };

export async function saveFile(filename: string, text: string): Promise<'saved' | 'declined' | 'failed'> {
  const host = (window as unknown as { claude?: ClaudeHost }).claude;
  if (host?.use) {
    const dl = (await host.use('downloads').catch(() => null)) as Downloads | null;
    if (dl) {
      try { await dl.save({ filename, data: text }); return 'saved'; }
      catch (e) { return (e as { code?: string }).code === 'declined' ? 'declined' : 'failed'; }
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return 'saved';
}
