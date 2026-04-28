import { formatUnits, isAddress } from 'viem';

export function shortAddr(addr) {
  if (!addr) return '—';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function fmtUSDC(value) {
  if (value == null) return '—';
  const n = Number(formatUnits(value, 6));
  if (n === 0) return '0';
  if (n < 0.01) return '<0.01';
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

export function assertAddress(v) {
  if (!isAddress(v)) throw new Error('Invalid address');
  return v;
}

export function formatCountdown(seconds) {
  if (seconds <= 0) return 'window expired';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function txUrl(hash) {
  return `https://testnet.arcscan.app/tx/${hash}`;
}

export function addressUrl(addr) {
  return `https://testnet.arcscan.app/address/${addr}`;
}
