import { useConfig } from 'wagmi';
import { writeContract } from 'wagmi/actions';
import { crossChainEscrowAbi } from '../abi/CrossChainEscrow';
import { ESCROW_ADDRESS } from '../config/contracts';
import { useRefundBalance } from '../hooks/useEscrows';
import { useTx } from '../hooks/useTx';
import { fmtUSDC } from '../utils/format';

export function WithdrawRefund() {
  const { data: balance, refetch } = useRefundBalance();
  const config = useConfig();
  const { run, pending } = useTx();

  const hasBalance = balance && balance > 0n;

  async function handleWithdraw() {
    await run({
      label: 'Withdraw refund',
      action: () =>
        writeContract(config, {
          address: ESCROW_ADDRESS,
          abi: crossChainEscrowAbi,
          functionName: 'withdrawRefund',
          args: [],
        }),
      onReceipt: () => refetch(),
    });
  }

  return (
    <section className="card p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Refund balance</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            USDC from cancelled or arbiter-refunded escrows. Withdraw any time.
          </p>
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">
            Available
          </div>
          <div className="text-2xl font-mono font-semibold text-slate-100 mt-0.5">
            {fmtUSDC(balance ?? 0n)}{' '}
            <span className="text-sm text-slate-500">USDC</span>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <button
          className="btn-primary"
          disabled={!hasBalance || pending}
          onClick={handleWithdraw}
        >
          {pending ? 'Withdrawing…' : hasBalance ? 'Withdraw refund' : 'Nothing to withdraw'}
        </button>
      </div>
    </section>
  );
}
