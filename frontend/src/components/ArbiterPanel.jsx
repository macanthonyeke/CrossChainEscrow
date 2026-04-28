import { useConfig } from 'wagmi';
import { writeContract } from 'wagmi/actions';
import { crossChainEscrowAbi } from '../abi/CrossChainEscrow';
import { CCTP_DOMAINS, ESCROW_ADDRESS } from '../config/contracts';
import { useDisputedEscrows } from '../hooks/useEscrows';
import { useTx } from '../hooks/useTx';
import { addressUrl, fmtUSDC, shortAddr } from '../utils/format';
import { notifyDisputeResolved } from '../utils/notifications';

function destName(domain) {
  return CCTP_DOMAINS.find((d) => d.id === domain)?.name ?? `Domain ${domain}`;
}


export function ArbiterPanel() {
  const { data: disputed, isLoading, refetch } = useDisputedEscrows();
  const config = useConfig();
  const { run, pending } = useTx();

  async function resolve(escrow, releaseToRecipient) {
    const label = releaseToRecipient
      ? 'Release to recipient'
      : 'Refund to depositor';
    const result = await run({
      label,
      action: () =>
        writeContract(config, {
          address: ESCROW_ADDRESS,
          abi: crossChainEscrowAbi,
          functionName: 'resolveDispute',
          args: [BigInt(escrow.id), releaseToRecipient],
        }),
      onReceipt: () => refetch(),
    });
    if (result) {
      notifyDisputeResolved({
        escrowId: escrow.id,
        depositor: escrow.depositor,
        recipient: escrow.recipient,
        refundTo: escrow.refundTo,
        amount: escrow.amount,
        destinationChain: destName(escrow.destinationDomain),
        disputeWindowSeconds: escrow.disputeWindow,
        releasedToRecipient: releaseToRecipient,
      }).catch(() => {});
    }
  }

  return (
    <section className="card p-6 border-amber-400/30 ring-1 ring-amber-400/20 bg-amber-400/[0.03]">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-widest text-amber-300 font-semibold mb-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
            Arbiter panel
          </div>
          <h2 className="text-lg font-semibold text-slate-100">
            Disputed escrows
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            You hold the arbiter role on this contract. Review and resolve
            disputes below.
          </p>
        </div>
        <button className="btn-ghost text-xs" onClick={() => refetch()}>
          ↻ Refresh
        </button>
      </div>

      {isLoading && (
        <div className="loading-shimmer rounded-xl h-28 border border-white/5" />
      )}

      {!isLoading && (!disputed || disputed.length === 0) && (
        <div className="rounded-xl border border-dashed border-amber-400/20 bg-white/[0.02] py-10 px-6 text-center">
          <p className="text-sm text-slate-300">No active disputes.</p>
          <p className="text-xs text-slate-500 mt-1">
            You will be notified when a dispute is raised.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3">
        {disputed?.map((e) => (
          <DisputeRow
            key={e.id}
            escrow={e}
            pending={pending}
            onResolve={resolve}
          />
        ))}
      </div>
    </section>
  );
}

function DisputeRow({ escrow, pending, onResolve }) {
  const raisedAt = escrow.conditionMetTimestamp
    ? new Date(
        (escrow.conditionMetTimestamp + escrow.disputeWindow) * 1000,
      ).toLocaleString()
    : '—';

  return (
    <div className="rounded-xl border border-amber-400/20 bg-white/[0.02] p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-amber-400/10 border border-amber-400/20 grid place-items-center">
            <span className="text-sm font-mono font-semibold text-amber-200">
              #{escrow.id}
            </span>
          </div>
          <div>
            <div className="text-lg font-semibold text-slate-100 font-mono">
              {fmtUSDC(escrow.amount)}{' '}
              <span className="text-slate-500 text-sm">USDC</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Destination · {destName(escrow.destinationDomain)}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">
            Dispute deadline
          </div>
          <div className="text-[12px] font-mono text-slate-300">{raisedAt}</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-[12px]">
        <Party label="Depositor" address={escrow.depositor} />
        <Party label="Recipient" address={escrow.recipient} />
        <Party label="Refund to" address={escrow.refundTo} />
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          className="btn-primary text-sm"
          disabled={pending}
          onClick={() => onResolve(escrow, true)}
        >
          Release to Recipient
        </button>
        <button
          className="btn-danger text-sm"
          disabled={pending}
          onClick={() => onResolve(escrow, false)}
        >
          Refund to Depositor
        </button>
      </div>
    </div>
  );
}

function Party({ label, address }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">
        {label}
      </div>
      <a
        href={addressUrl(address)}
        target="_blank"
        rel="noreferrer"
        className="font-mono text-slate-300 hover:text-accent-cyan"
      >
        {shortAddr(address)}
      </a>
    </div>
  );
}
