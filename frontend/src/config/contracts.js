import { keccak256, toBytes } from 'viem';

export const ESCROW_ADDRESS = '0xd3b72F459FB77019a5103bdcA152fB61268E3B90';
export const TOKEN_MESSENGER_ADDRESS = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA';
export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';

export const EXPLORER_URL = 'https://testnet.arcscan.app';

export const ARBITER_ROLE = keccak256(toBytes('ARBITER_ROLE'));

export const ARBITER_ADDRESS = '0x512C59e0cFE63147E63406d4b0FE4198C201A0AE';

export const ARBITER_EMAIL = 'macanthonyeke@gmail.com';

export const ESCROW_STATES = [
  'DEPOSITED',
  'CONDITION_MET',
  'DISPUTED',
  'RELEASED',
  'REFUNDED',
];

export const STATE_META = {
  DEPOSITED: {
    label: 'Deposited',
    dot: 'bg-accent-cyan',
    text: 'text-accent-cyan',
    bg: 'bg-accent-cyan/10',
    border: 'border-accent-cyan/30',
  },
  CONDITION_MET: {
    label: 'Condition met',
    dot: 'bg-amber-400',
    text: 'text-amber-300',
    bg: 'bg-amber-400/10',
    border: 'border-amber-400/30',
  },
  DISPUTED: {
    label: 'Disputed',
    dot: 'bg-rose-400',
    text: 'text-rose-300',
    bg: 'bg-rose-400/10',
    border: 'border-rose-400/30',
  },
  RELEASED: {
    label: 'Released',
    dot: 'bg-emerald-400',
    text: 'text-emerald-300',
    bg: 'bg-emerald-400/10',
    border: 'border-emerald-400/30',
  },
  REFUNDED: {
    label: 'Refunded',
    dot: 'bg-slate-400',
    text: 'text-slate-300',
    bg: 'bg-slate-400/10',
    border: 'border-slate-400/30',
  },
};

// CCTP v1 domain IDs — see https://developers.circle.com/cctp
export const CCTP_DOMAINS = [
  { id: 0, name: 'Ethereum', icon: '🔹' },
  { id: 1, name: 'Avalanche', icon: '🔺' },
  { id: 2, name: 'OP Mainnet', icon: '🔴' },
  { id: 3, name: 'Arbitrum', icon: '🔷' },
  { id: 6, name: 'Base', icon: '🟦' },
  { id: 7, name: 'Polygon PoS', icon: '🟣' },
  { id: 26, name: 'Arc', icon: '🌐' },
];

export const DISPUTE_WINDOWS = [
  { label: '1 hour', seconds: 60 * 60 },
  { label: '24 hours', seconds: 24 * 60 * 60 },
  { label: '48 hours', seconds: 48 * 60 * 60 },
  { label: '72 hours', seconds: 72 * 60 * 60 },
];
