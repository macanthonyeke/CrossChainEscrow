import { ConnectWallet } from './ConnectWallet';
import { NotificationBell } from './NotificationBell';

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-ink-950/80 backdrop-blur-xl">
      <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-accent-purple to-accent-cyan grid place-items-center shadow-glow">
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5 text-ink-950"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M7 8h8a4 4 0 0 1 0 8h-4l6 6" />
              <path d="M3 6l4-4 4 4" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight text-slate-100">
              CrossChainEscrow
            </div>
            <div className="text-[11px] text-slate-500 font-mono">
              Arc Testnet · Circle CCTP
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <NotificationBell />
          <ConnectWallet />
        </div>
      </div>
    </header>
  );
}
