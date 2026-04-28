import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useNotificationEmail } from '../hooks/useNotificationEmail';

export function NotificationModal({ open, onClose }) {
  const { email, saveEmail, clearEmail, skip } = useNotificationEmail();
  const [value, setValue] = useState(email ?? '');

  useEffect(() => {
    if (open) setValue(email ?? '');
  }, [open, email]);

  if (!open) return null;

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

  function handleEnable() {
    if (!valid) {
      toast.error('Please enter a valid email address');
      return;
    }
    saveEmail(value.trim());
    toast.success('Notifications enabled');
    onClose?.();
  }

  function handleSkip() {
    skip();
    onClose?.();
  }

  function handleRemove() {
    clearEmail();
    toast.success('Notifications turned off');
    setValue('');
    onClose?.();
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-base font-semibold text-slate-100">
              {email ? 'Notification settings' : 'Stay updated on your escrows'}
            </h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              {email
                ? 'Update or remove the email tied to this wallet.'
                : 'Enter your email to receive notifications when escrow states change.'}
            </p>
          </div>
          <button
            className="btn-ghost text-sm"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <label className="label">Email address</label>
        <input
          type="email"
          className="input"
          placeholder="you@example.com"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button className="btn-primary" onClick={handleEnable} disabled={!valid}>
            {email ? 'Save email' : 'Enable Notifications'}
          </button>
          {email && (
            <button className="btn-danger text-sm" onClick={handleRemove}>
              Remove
            </button>
          )}
          {!email && (
            <button
              className="text-xs text-slate-500 hover:text-slate-300 underline-offset-2 hover:underline ml-auto"
              onClick={handleSkip}
            >
              Skip for now
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
