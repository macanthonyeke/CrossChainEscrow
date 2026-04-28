import { useCallback, useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import {
  getEmailForWallet,
  getSkipped,
  removeEmailForWallet,
  setEmailForWallet,
  setSkipped,
} from '../utils/notifications';

export function useNotificationEmail() {
  const { address } = useAccount();
  const [email, setEmailState] = useState(() => getEmailForWallet(address));
  const [skipped, setSkippedState] = useState(() => getSkipped(address));

  useEffect(() => {
    setEmailState(getEmailForWallet(address));
    setSkippedState(getSkipped(address));
  }, [address]);

  useEffect(() => {
    function onChange() {
      setEmailState(getEmailForWallet(address));
      setSkippedState(getSkipped(address));
    }
    window.addEventListener('cce:notifications-changed', onChange);
    return () => window.removeEventListener('cce:notifications-changed', onChange);
  }, [address]);

  const saveEmail = useCallback(
    (value) => {
      if (!address) return;
      setEmailForWallet(address, value);
      setSkipped(address, false);
    },
    [address],
  );

  const clearEmail = useCallback(() => {
    if (!address) return;
    removeEmailForWallet(address);
  }, [address]);

  const skip = useCallback(() => {
    if (!address) return;
    setSkipped(address, true);
  }, [address]);

  return { email, skipped, saveEmail, clearEmail, skip };
}
