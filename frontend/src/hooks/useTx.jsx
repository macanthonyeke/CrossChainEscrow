import { useCallback, useState } from 'react';
import toast from 'react-hot-toast';
import { useConfig } from 'wagmi';
import { waitForTransactionReceipt } from 'wagmi/actions';
import { txUrl } from '../utils/format';

/**
 * Wraps a write-contract flow so we get consistent toasts, explorer links,
 * and pending state across the app.
 */
export function useTx() {
  const config = useConfig();
  const [pending, setPending] = useState(false);

  const run = useCallback(
    async ({ label, action, onReceipt }) => {
      setPending(true);
      const loadingId = toast.loading(`${label}…`);
      try {
        const hash = await action();
        toast.loading(
          (t) => (
            <span>
              {label} sent.{' '}
              <a
                href={txUrl(hash)}
                target="_blank"
                rel="noreferrer"
                className="underline text-accent-cyan"
              >
                View tx
              </a>
            </span>
          ),
          { id: loadingId },
        );
        const receipt = await waitForTransactionReceipt(config, { hash });
        if (receipt.status !== 'success') throw new Error('Transaction reverted');
        toast.success(
          (t) => (
            <span>
              {label} confirmed.{' '}
              <a
                href={txUrl(hash)}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                View tx
              </a>
            </span>
          ),
          { id: loadingId, duration: 6000 },
        );
        if (onReceipt) await onReceipt(receipt);
        return { hash, receipt };
      } catch (err) {
        const msg = err?.shortMessage || err?.message || 'Transaction failed';
        toast.error(msg, { id: loadingId });
        return null;
      } finally {
        setPending(false);
      }
    },
    [config],
  );

  return { run, pending };
}
