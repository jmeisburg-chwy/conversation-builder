export default function Home() {
  return (
    <main className="standalone-builder-page">
      <header className="site-header builder-site-header">
        <div className="brand-lockup" aria-label="Chewy Conversation Simulator">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="chewy-logo" src="/chewy-emblem.png" alt="Chewy" width="1200" height="675" />
          <span className="brand-product">Conversation Simulator</span>
        </div>
      </header>
      <iframe
        className="builder-frame"
        title="Conversation Builder"
        src="/builder-studio/index.html?standalone=1"
        sandbox="allow-downloads allow-forms allow-modals allow-same-origin allow-scripts"
      />
    </main>
  );
}
