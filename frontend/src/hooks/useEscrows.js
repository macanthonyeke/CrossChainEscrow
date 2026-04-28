import { useQuery } from '@tanstack/react-query';
import { useAccount, useConfig, useReadContract } from 'wagmi';
import { readContracts } from 'wagmi/actions';
import { crossChainEscrowAbi } from '../abi/CrossChainEscrow';
import { ARBITER_ROLE, ESCROW_ADDRESS, ESCROW_STATES } from '../config/contracts';

function toEscrowRecord(id, tuple) {
  const [
    depositor,
    recipient,
    refundTo,
    amount,
    destinationDomain,
    mintRecipient,
    conditionMetTimestamp,
    disputeWindow,
    depositorApproveCancel,
    recipientApproveCancel,
    state,
  ] = tuple;
  return {
    id,
    depositor,
    recipient,
    refundTo,
    amount,
    destinationDomain: Number(destinationDomain),
    mintRecipient,
    conditionMetTimestamp: Number(conditionMetTimestamp),
    disputeWindow: Number(disputeWindow),
    depositorApproveCancel,
    recipientApproveCancel,
    state: ESCROW_STATES[Number(state)] ?? 'UNKNOWN',
  };
}

export function useEscrowCount() {
  return useReadContract({
    address: ESCROW_ADDRESS,
    abi: crossChainEscrowAbi,
    functionName: 'escrowCount',
    query: { refetchInterval: 15_000 },
  });
}

export function useUserEscrows() {
  const { address } = useAccount();
  const config = useConfig();
  const { data: escrowCount } = useEscrowCount();

  return useQuery({
    enabled: Boolean(address) && escrowCount !== undefined,
    queryKey: ['user-escrows', address, escrowCount?.toString() ?? '0'],
    refetchInterval: 15_000,
    queryFn: async () => {
      const count = Number(escrowCount ?? 0n);
      if (count === 0) return [];

      const calls = [];
      for (let i = 1; i <= count; i++) {
        calls.push({
          address: ESCROW_ADDRESS,
          abi: crossChainEscrowAbi,
          functionName: 'escrows',
          args: [BigInt(i)],
        });
      }

      const results = await readContracts(config, { contracts: calls, allowFailure: true });

      const escrows = [];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status !== 'success' || !r.result) continue;
        const record = toEscrowRecord(i + 1, r.result);
        if (!record.depositor || record.depositor === '0x0000000000000000000000000000000000000000') {
          continue;
        }
        const lower = address.toLowerCase();
        if (
          record.depositor.toLowerCase() === lower ||
          record.recipient.toLowerCase() === lower ||
          record.refundTo.toLowerCase() === lower
        ) {
          escrows.push(record);
        }
      }
      return escrows.sort((a, b) => b.id - a.id);
    },
  });
}

export function useIsArbiter() {
  const { address } = useAccount();
  return useReadContract({
    address: ESCROW_ADDRESS,
    abi: crossChainEscrowAbi,
    functionName: 'hasRole',
    args: address ? [ARBITER_ROLE, address] : undefined,
    query: { enabled: Boolean(address) },
  });
}

export function useDisputedEscrows() {
  const config = useConfig();
  const { data: escrowCount } = useEscrowCount();

  return useQuery({
    enabled: escrowCount !== undefined,
    queryKey: ['disputed-escrows', escrowCount?.toString() ?? '0'],
    refetchInterval: 15_000,
    queryFn: async () => {
      const count = Number(escrowCount ?? 0n);
      if (count === 0) return [];

      const calls = [];
      for (let i = 1; i <= count; i++) {
        calls.push({
          address: ESCROW_ADDRESS,
          abi: crossChainEscrowAbi,
          functionName: 'escrows',
          args: [BigInt(i)],
        });
      }

      const results = await readContracts(config, { contracts: calls, allowFailure: true });

      const disputed = [];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status !== 'success' || !r.result) continue;
        const record = toEscrowRecord(i + 1, r.result);
        if (record.state === 'DISPUTED') disputed.push(record);
      }
      return disputed.sort((a, b) => b.id - a.id);
    },
  });
}

export function useRefundBalance() {
  const { address } = useAccount();
  return useReadContract({
    address: ESCROW_ADDRESS,
    abi: crossChainEscrowAbi,
    functionName: 'refundBalances',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: 15_000 },
  });
}
