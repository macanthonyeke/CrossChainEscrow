import { useMemo, useState } from 'react';
import { useEscrowCount, useUserEscrows } from '../hooks/useEscrows';
import { EscrowCard } from './EscrowCard';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'DEPOSITED', label: 'Deposited' },
  { id: 'CONDITION_MET', label: 'Condition met' },
  { id: 'DISPUTED', label: 'Disputed' },
  { id: 'RELEASED', label: 'Released' },
  { id: 'REFUNDED', label: 'Refunded' },
];

export function EscrowDashboard() {
  const { data: escrows, isLoading, refetch } = useUserEscrows();
  const { data: total } = useEscrowCount();
  const [filter, setFilter] = useState('all');

  const filtered = useMemo(() => {
    if (!escrows) return [];
    if (filter === 'all') return escrows;
    if (filter === 'active') {
      return escrows.filter((e) =>
        ['DEPOSITED', 'CONDITION_MET', 'DISPUTED'].includes(e.state),
      );
    }
    return escrows.filter((e) => e.state === filter);
  }, [escrows, filter]);

  return (
    <section className="card p-6">
      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Your escrows</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Escrows where you are depositor, recipient, or refund address.
            {total !== undefined && (
              <> <span className="kbd ml-1">{total.toString()} total on-chain</span></>
            )}
          </p>
        </div>
        <button className="btn-ghost text-xs" onClick={() => refetch()}>
          ↻ Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              filter === f.id
                ? 'bg-white/10 text-slate-100 border border-white/10'
                : 'text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading && <Skeleton />}

      {!isLoading && (!escrows || escrows.length === 0) && <EmptyState />}

      {!isLoading && filtered.length === 0 && escrows?.length > 0 && (
        <div className="text-sm text-slate-500 py-8 text-center">
          No escrows match this filter.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3">
        {filtered.map((e) => (
          <EscrowCard key={e.id} escrow={e} onAction={refetch} />
        ))}
      </div>
    </section>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="loading-shimmer rounded-xl h-28 border border-white/5" />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] py-12 px-6 text-center">
      <div className="mx-auto h-10 w-10 rounded-full bg-white/5 grid place-items-center mb-3">
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5 text-slate-500"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 10h18" />
        </svg>
      </div>
      <p className="text-sm text-slate-300">No escrows yet.</p>
      <p className="text-xs text-slate-500 mt-1">
        Create an escrow above to get started.
      </p>
    </div>
  );
}
