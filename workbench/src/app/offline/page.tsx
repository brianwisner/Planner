export default function OfflinePage() {
  return (
    <main className="flex-1 flex items-center justify-center p-6 text-center">
      <div className="card max-w-sm">
        <h1 className="h2 mb-2">You are offline</h1>
        <p className="text-sm muted">This page has not been loaded before, so it is not available offline. Reconnect and try again. Pages you opened recently may still load.</p>
      </div>
    </main>
  );
}
