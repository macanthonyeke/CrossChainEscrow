import { useMemo, useState } from 'react';
import { decodeEventLog, isAddress, pad, parseUnits } from 'viem';
import { useAccount, useConfig, useReadContract } from 'wagmi';
import { readContract, writeContract } from 'wagmi/actions';
import toast from 'react-hot-toast';
import { erc20Abi } from '../abi/erc20';
import { crossChainEscrowAbi } from '../abi/CrossChainEscrow';
import {
  ARBITER_ADDRESS,
  CCTP_DOMAINS,
  DISPUTE_WINDOWS,
  ESCROW_ADDRESS,
  USDC_ADDRESS,
} from '../config/contracts';
import { useTx } from '../hooks/useTx';
import {
  notifyDepositCreated,
  setEmailForWallet,
} from '../utils/notifications';

const initialForm = {
  recipient: '',
  recipientEmail: '',
  refundTo: '',
  amount: '',
  destinationDomain: '26',
  destinationRecipient: '',
  disputeWindow: String(24 * 60 * 60),
};

export function CreateEscrow({ onCreated }) {
  const { address } = useAccount();
  const config = useConfig();
  const { run, pending } = useTx();
  const [form, setForm] = useState(initialForm);
  const [useDifferentDest, setUseDifferentDest] = useState(false);

  const parsedAmount = useMemo(() => {
    if (!form.amount) return null;
    try {
      return parseUnits(form.amount, 6);
    } catch {
      return null;
    }
  }, [form.amount]);

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address ? [address, ESCROW_ADDRESS] : undefined,
    query: { enabled: Boolean(address) },
  });

  const needsApproval =
    parsedAmount != null && (allowance == null || allowance < parsedAmount);

  const effectiveDestRecipient = useDifferentDest
    ? form.destinationRecipient
    : form.recipient;

  const isArbiterAddr = (addr) =>
    isAddress(addr) && addr.toLowerCase() === ARBITER_ADDRESS.toLowerCase();

  const recipientIsArbiter = isArbiterAddr(form.recipient);
  const destRecipientIsArbiter =
    useDifferentDest && isArbiterAddr(form.destinationRecipient);

  const validate = () => {
    if (!isAddress(form.recipient)) return 'Invalid recipient address';
    if (recipientIsArbiter) return 'The arbiter cannot be set as recipient.';
    if (!isAddress(form.refundTo)) return 'Invalid refund address';
    if (useDifferentDest && !isAddress(form.destinationRecipient))
      return 'Invalid destination recipient address';
    if (destRecipientIsArbiter)
      return 'The arbiter cannot be set as recipient.';
    if (!parsedAmount || parsedAmount === 0n) return 'Enter a non-zero amount';
    if (Number(form.disputeWindow) < 3600) return 'Dispute window must be ≥ 1 hour';
    if (
      form.recipientEmail &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.recipientEmail.trim())
    )
      return 'Invalid recipient email address';
    return null;
  };

  async function handleApprove() {
    await run({
      label: 'Approve USDC',
      action: () =>
        writeContract(config, {
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: 'approve',
          args: [ESCROW_ADDRESS, parsedAmount],
        }),
      onReceipt: async () => {
        await refetchAllowance();
      },
    });
  }

  async function handleDeposit() {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }

    const current = await readContract(config, {
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [address, ESCROW_ADDRESS],
    });
    if (current < parsedAmount) {
      toast.error('Approve USDC first');
      return;
    }

    const mintRecipient32 = pad(effectiveDestRecipient, { size: 32 });

    const result = await run({
      label: 'Create escrow',
      action: () =>
        writeContract(config, {
          address: ESCROW_ADDRESS,
          abi: crossChainEscrowAbi,
          functionName: 'deposit',
          args: [
            form.recipient,
            form.refundTo,
            parsedAmount,
            Number(form.destinationDomain),
            mintRecipient32,
            BigInt(form.disputeWindow),
          ],
        }),
    });

    if (result) {
      const destChain =
        CCTP_DOMAINS.find((d) => d.id === Number(form.destinationDomain))?.name ??
        `Domain ${form.destinationDomain}`;
      let escrowId;
      try {
        for (const log of result.receipt.logs ?? []) {
          if (log.address.toLowerCase() !== ESCROW_ADDRESS.toLowerCase()) continue;
          try {
            const decoded = decodeEventLog({
              abi: crossChainEscrowAbi,
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName === 'EscrowCreated') {
              escrowId = decoded.args.escrowId?.toString();
              break;
            }
          } catch {
            // skip unmatched logs
          }
        }
      } catch {
        // fall through — escrowId may be undefined
      }
      const recipientEmail = form.recipientEmail.trim();
      if (recipientEmail) {
        setEmailForWallet(form.recipient, recipientEmail);
      }
      notifyDepositCreated({
        escrowId,
        depositor: address,
        recipient: form.recipient,
        amount: parsedAmount,
        destinationChain: destChain,
        disputeWindowSeconds: Number(form.disputeWindow),
      }).catch(() => {});
      setForm(initialForm);
      setUseDifferentDest(false);
      onCreated?.();
    }
  }

  const onInput = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const fillSelf = (key) => () => {
    if (!address) return;
    setForm((f) => ({ ...f, [key]: address }));
  };

  return (
    <section className="card p-6">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Create escrow</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Lock USDC on Arc — release to the recipient via CCTP on any supported chain.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field
          label="Recipient wallet address"
          hint={
            recipientIsArbiter
              ? null
              : 'Used on Arc for permissions, and by default on the destination chain'
          }
          error={
            recipientIsArbiter ? 'The arbiter cannot be set as recipient.' : null
          }
        >
          <div className="relative">
            <input
              className={`input pr-16 ${
                recipientIsArbiter ? 'border-rose-400/60 focus:border-rose-400' : ''
              }`}
              placeholder="0x…"
              value={form.recipient}
              onChange={onInput('recipient')}
              aria-invalid={recipientIsArbiter || undefined}
            />
            <button
              type="button"
              onClick={fillSelf('recipient')}
              className="kbd absolute right-2 top-1/2 -translate-y-1/2"
            >
              me
            </button>
          </div>
        </Field>

        <Field
          label="Recipient email (optional)"
          hint="Sent to the recipient when the escrow is created and updated"
        >
          <input
            className="input"
            type="email"
            placeholder="recipient@example.com"
            value={form.recipientEmail}
            onChange={onInput('recipientEmail')}
          />
        </Field>

        <Field label="Refund address (Arc)" hint="Who can claim if the escrow is refunded">
          <div className="relative">
            <input
              className="input pr-16"
              placeholder="0x…"
              value={form.refundTo}
              onChange={onInput('refundTo')}
            />
            <button
              type="button"
              onClick={fillSelf('refundTo')}
              className="kbd absolute right-2 top-1/2 -translate-y-1/2"
            >
              me
            </button>
          </div>
        </Field>

        <Field label="Amount" hint="USDC · 6 decimals">
          <div className="relative">
            <input
              className="input pr-16"
              placeholder="0.00"
              inputMode="decimal"
              value={form.amount}
              onChange={onInput('amount')}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 font-mono">
              USDC
            </span>
          </div>
        </Field>

        <Field
          label="Destination chain"
          hint={`CCTP domain ${form.destinationDomain} on release`}
        >
          <select
            className="select"
            value={form.destinationDomain}
            onChange={onInput('destinationDomain')}
            title={`CCTP domain ${form.destinationDomain}`}
          >
            {CCTP_DOMAINS.map((d) => (
              <option
                key={d.id}
                value={d.id}
                className="bg-ink-800"
                title={`CCTP domain ${d.id}`}
              >
                {d.icon}  {d.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Dispute window" hint="Time to raise disputes after fulfillment">
          <select
            className="select"
            value={form.disputeWindow}
            onChange={onInput('disputeWindow')}
          >
            {DISPUTE_WINDOWS.map((w) => (
              <option key={w.seconds} value={w.seconds} className="bg-ink-800">
                {w.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-4">
        <label className="inline-flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
          <input
            type="checkbox"
            className="accent-accent-cyan h-3.5 w-3.5"
            checked={useDifferentDest}
            onChange={(e) => setUseDifferentDest(e.target.checked)}
          />
          Use a different address on destination chain
        </label>
        {useDifferentDest && (
          <div className="mt-3 max-w-md">
            <Field
              label="Recipient on destination"
              hint={
                destRecipientIsArbiter
                  ? null
                  : 'EVM address on the destination chain'
              }
              error={
                destRecipientIsArbiter
                  ? 'The arbiter cannot be set as recipient.'
                  : null
              }
            >
              <div className="relative">
                <input
                  className={`input pr-16 ${
                    destRecipientIsArbiter
                      ? 'border-rose-400/60 focus:border-rose-400'
                      : ''
                  }`}
                  placeholder="0x…"
                  value={form.destinationRecipient}
                  onChange={onInput('destinationRecipient')}
                  aria-invalid={destRecipientIsArbiter || undefined}
                />
                <button
                  type="button"
                  onClick={fillSelf('destinationRecipient')}
                  className="kbd absolute right-2 top-1/2 -translate-y-1/2"
                >
                  me
                </button>
              </div>
            </Field>
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          className="btn-secondary"
          onClick={handleApprove}
          disabled={!address || !parsedAmount || !needsApproval || pending}
        >
          {!parsedAmount
            ? '1. Approve USDC'
            : !needsApproval
            ? '✓ USDC approved'
            : '1. Approve USDC'}
        </button>
        <button
          className="btn-primary"
          onClick={handleDeposit}
          disabled={
            !address ||
            !parsedAmount ||
            needsApproval ||
            pending ||
            recipientIsArbiter ||
            destRecipientIsArbiter
          }
        >
          {pending ? 'Submitting…' : '2. Deposit into escrow'}
        </button>
      </div>
    </section>
  );
}

function Field({ label, hint, error, children }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {error ? (
        <p className="mt-1.5 text-[11px] text-rose-300">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-[11px] text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}
