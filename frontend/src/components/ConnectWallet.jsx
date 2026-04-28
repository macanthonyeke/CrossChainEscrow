import { useState } from 'react';
import {
  useAccount,
  useBalance,
  useChainId,
  useConnect,
  useDisconnect,
  useSwitchChain,
} from 'wagmi';
import { arcTestnet } from '../config/wagmi';
import { USDC_ADDRESS } from '../config/contracts';
import { addressUrl, fmtUSDC, shortAddr } from '../utils/format';

export function ConnectWallet() {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain, isPending: switching } = useSwitchChain();
  const [open, setOpen] = useState(false);

  const { data: usdc } = useBalance({
    address,
    token: USDC_ADDRESS,
    chainId: arcTestnet.id,
    query: { enabled: Boolean(address), refetchInterval: 15_000 },
  });

  if (!isConnected) {
    return (
      <div className="relative">
        <button className="btn-primary" disabled={isPending} onClick={() => setOpen((v) => !v)}>
          {isPending ? 'Connecting…' : 'Connect wallet'}
        </button>
        {open && (
          <div
            className="absolute right-0 mt-2 w-60 card p-1.5 z-40"
            onMouseLeave={() => setOpen(false)}
          >
            {connectors.map((c) => (
              <button
                key={c.uid}
                onClick={() => {
                  connect({ connector: c, chainId: arcTestnet.id });
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 rounded-md hover:bg-white/5 text-sm flex items-center justify-between"
              >
                <span>{c.name}</span>
                <span className="text-[10px] text-slate-500 uppercase">{c.type}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const wrongChain = chainId !== arcTestnet.id;

  return (
    <div className="flex items-center gap-2">
      {wrongChain ? (
        <button
          className="btn-danger"
          disabled={switching}
          onClick={() => switchChain({ chainId: arcTestnet.id })}
        >
          {switching ? 'Switching…' : 'Switch to Arc Testnet'}
        </button>
      ) : (
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-ink-800/80 border border-white/5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-mono text-slate-300">
            {usdc ? fmtUSDC(usdc.value) : '0'} USDC
          </span>
        </div>
      )}
      <a
        href={address ? addressUrl(address) : '#'}
        target="_blank"
        rel="noreferrer"
        className="btn-secondary font-mono text-xs"
      >
        {shortAddr(address)}
      </a>
      <button className="btn-ghost text-xs" onClick={() => disconnect()}>
        Disconnect
      </button>
    </div>
  );
}
