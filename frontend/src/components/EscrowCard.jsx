import { useEffect, useState } from 'react';
import { useAccount, useConfig } from 'wagmi';
import { writeContract } from 'wagmi/actions';
import { crossChainEscrowAbi } from '../abi/CrossChainEscrow';
import { CCTP_DOMAINS, ESCROW_ADDRESS, STATE_META } from '../config/contracts';
import { useTx } from '../hooks/useTx';
import {
  addressUrl,
  fmtUSDC,
  formatCountdown,
  shortAddr,
} from '../utils/format';
import {
  notifyConditionFulfilled,
  notifyDisputeRaised,
  notifyMutualCancel,
  notifyReleasedAfterWindow,
} from '../utils/notifications';

function destName(domain) {
  return CCTP_DOMAINS.find((d) => d.id === domain)?.name ?? `Domain ${domain}`;
}

export function EscrowCard({ escrow, onAction }) {
  const { address } = useAccount();
  const config = useConfig();
  const { run, pending } = useTx();
  const meta = STATE_META[escrow.state] ?? STATE_META.DEPOSITED;

  const me = address?.toLowerCase();
  const isDepositor = me === escrow.depositor.toLowerCase();
  const isRecipient = me === escrow.recipient.toLowerCase();

  const deadline = escrow.conditionMetTimestamp
    ? escrow.conditionMetTimestamp + escrow.disputeWindow
    : 0;
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    if (escrow.state !== 'CONDITION_MET') return;
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, [escrow.state]);

  const remaining = deadline - now;
  const windowExpired = escrow.state === 'CONDITION_MET' && remaining <= 0;

  async function call(label, fn, args, onSuccess) {
    const result = await run({
      label,
      action: () =>
        writeContract(config, {
          address: ESCROW_ADDRESS,
          abi: crossChainEscrowAbi,
          functionName: fn,
          args,
        }),
      onReceipt: () => onAction?.(),
    });
    if (result && onSuccess) onSuccess();
  }

  const mutualCancelWillFinalize =
    escrow.state === 'DEPOSITED' &&
    ((isDepositor && escrow.recipientApproveCancel) ||
      (isRecipient && escrow.depositorApproveCancel));

  const destinationChain = destName(escrow.destinationDomain);

  function onFulfill() {
    notifyConditionFulfilled({
      escrowId: escrow.id,
      depositor: escrow.depositor,
      recipient: escrow.recipient,
      amount: escrow.amount,
      destinationChain,
      disputeWindowSeconds: escrow.disputeWindow,
    }).catch(() => {});
  }
  function onDispute() {
    notifyDisputeRaised({
      escrowId: escrow.id,
      depositor: escrow.depositor,
      recipient: escrow.recipient,
      amount: escrow.amount,
      destinationChain,
      disputeWindowSeconds: escrow.disputeWindow,
    }).catch(() => {});
  }
  function onRelease() {
    notifyReleasedAfterWindow({
      escrowId: escrow.id,
      depositor: escrow.depositor,
      recipient: escrow.recipient,
      amount: escrow.amount,
      destinationChain,
      disputeWindowSeconds: escrow.disputeWindow,
    }).catch(() => {});
  }
  function onMutualCancel() {
    if (!mutualCancelWillFinalize) return;
    notifyMutualCancel({
      escrowId: escrow.id,
      depositor: escrow.depositor,
      recipient: escrow.recipient,
      amount: escrow.amount,
      destinationChain,
      disputeWindowSeconds: escrow.disputeWindow,
    }).catch(() => {});
  }

  return (
    <div className="card card-hover p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-accent-purple/20 to-accent-cyan/20 border border-white/5 grid place-items-center">
            <span className="text-sm font-mono font-semibold text-slate-200">
              #{escrow.id}
            </span>
          </div>
          <div>
            <div className="text-lg font-semibold text-slate-100 font-mono">
              {fmtUSDC(escrow.amount)} <span className="text-slate-500 text-sm">USDC</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Destination · {destName(escrow.destinationDomain)}
            </div>
          </div>
        </div>
        <div className={`pill ${meta.bg} ${meta.text} border ${meta.border}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
          {meta.label}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-[12px]">
        <PartyLine label="Depositor" address={escrow.depositor} isYou={isDepositor} />
        <PartyLine label="Recipient (Arc)" address={escrow.recipient} isYou={isRecipient} />
        <PartyLine label="Refund to" address={escrow.refundTo} isYou={me === escrow.refundTo.toLowerCase()} />
      </div>

      {escrow.state === 'CONDITION_MET' && (
        <div className="mt-4 flex items-center gap-2 text-[12px]">
          <span className="text-slate-500">Dispute window</span>
          <span
            className={`font-mono ${
              windowExpired ? 'text-emerald-300' : 'text-amber-300'
            }`}
          >
            {formatCountdown(remaining)}
          </span>
        </div>
      )}

      {escrow.state === 'RELEASED' && (
        <div className="mt-4 text-[12px] text-emerald-300/90">
          Released via CCTP to {destName(escrow.destinationDomain)}
        </div>
      )}

      {escrow.state === 'DISPUTED' && (
        <div className="mt-4 text-[12px] text-rose-300/90">
          Waiting for arbiter to resolve dispute…
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        {escrow.state === 'DEPOSITED' && isDepositor && (
          <button
            className="btn-primary text-sm"
            disabled={pending}
            onClick={() =>
              call(
                'Fulfill condition',
                'fulfillCondition',
                [BigInt(escrow.id)],
                onFulfill,
              )
            }
          >
            Fulfill condition
          </button>
        )}
        {escrow.state === 'DEPOSITED' && (isDepositor || isRecipient) && (
          <button
            className="btn-secondary text-sm"
            disabled={pending}
            onClick={() =>
              call(
                'Approve cancel',
                'mutualCancel',
                [BigInt(escrow.id)],
                onMutualCancel,
              )
            }
          >
            {cancelLabel(escrow, isDepositor, isRecipient)}
          </button>
        )}

        {escrow.state === 'CONDITION_MET' && (isDepositor || isRecipient) && !windowExpired && (
          <button
            className="btn-danger text-sm"
            disabled={pending}
            onClick={() =>
              call(
                'Raise dispute',
                'raiseDispute',
                [BigInt(escrow.id)],
                onDispute,
              )
            }
          >
            Raise dispute
          </button>
        )}
        {escrow.state === 'CONDITION_MET' && windowExpired && (
          <button
            className="btn-primary text-sm"
            disabled={pending}
            onClick={() =>
              call(
                'Release via CCTP',
                'releaseAfterWindow',
                [BigInt(escrow.id)],
                onRelease,
              )
            }
          >
            Release via CCTP
          </button>
        )}
      </div>
    </div>
  );
}

function cancelLabel(escrow, isDepositor, isRecipient) {
  if (isDepositor && escrow.depositorApproveCancel) return 'Cancel approved · waiting';
  if (isRecipient && escrow.recipientApproveCancel) return 'Cancel approved · waiting';
  return 'Approve cancel';
}

function PartyLine({ label, address, isYou }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">
        {label}
      </div>
      <a
        href={addressUrl(address)}
        target="_blank"
        rel="noreferrer"
        className="font-mono text-slate-300 hover:text-accent-cyan inline-flex items-center gap-1.5"
      >
        {shortAddr(address)}
        {isYou && <span className="kbd">you</span>}
      </a>
    </div>
  );
}
