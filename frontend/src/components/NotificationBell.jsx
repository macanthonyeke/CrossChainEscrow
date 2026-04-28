import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { useNotificationEmail } from '../hooks/useNotificationEmail';
import { NotificationModal } from './NotificationModal';

export function NotificationBell() {
  const { address, isConnected } = useAccount();
  const { email, skipped, saveEmail } = useNotificationEmail();
  const [modalOpen, setModalOpen] = useState(false);
  const [promptedFor, setPromptedFor] = useState(null);

  // Auto-prompt on first connect for a wallet that hasn't seen the modal.
  useEffect(() => {
    if (!isConnected || !address) return;
    if (promptedFor === address) return;
    if (!email && !skipped) {
      setModalOpen(true);
    }
    setPromptedFor(address);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, isConnected]);

  // Listen for external requests to open the modal (e.g. from other components).
  useEffect(() => {
    function open() {
      setModalOpen(true);
    }
    window.addEventListener('cce:open-notifications', open);
    return () => window.removeEventListener('cce:open-notifications', open);
  }, []);

  if (!isConnected) return null;

  const hasEmail = Boolean(email);
  const tooltip = hasEmail
    ? `Notifications enabled · ${email}`
    : 'Notifications not set up';

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="relative flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-white/5 hover:bg-white/5 transition-colors"
        title={tooltip}
      >
        <span className="relative inline-flex">
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4 text-slate-300"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10 21a2 2 0 0 0 4 0" />
          </svg>
          <span
            className={`absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-ink-950 ${
              hasEmail ? 'bg-emerald-400' : 'bg-amber-400'
            }`}
          />
        </span>
        <span className="hidden md:inline text-[11px] text-slate-400">
          {hasEmail ? 'Notifications enabled' : 'Notifications not set up'}
        </span>
      </button>
      <NotificationModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}

export function openNotificationModal() {
  window.dispatchEvent(new Event('cce:open-notifications'));
}
