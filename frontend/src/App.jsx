import { useAccount, useChainId } from 'wagmi';
import { Header } from './components/Header';
import { CreateEscrow } from './components/CreateEscrow';
import { EscrowDashboard } from './components/EscrowDashboard';
import { WithdrawRefund } from './components/WithdrawRefund';
import { ArbiterPanel } from './components/ArbiterPanel';
import { arcTestnet } from './config/wagmi';
import { ESCROW_ADDRESS, EXPLORER_URL } from './config/contracts';
import { useIsArbiter } from './hooks/useEscrows';
import { shortAddr } from './utils/format';

export default function App() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const onWrongChain = isConnected && chainId !== arcTestnet.id;
  const { data: isArbiter } = useIsArbiter();

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 mx-auto max-w-6xl w-full px-6 py-10">
        {isConnected && !onWrongChain && isArbiter ? (
          <ArbiterHero />
        ) : (
          <Hero />
        )}
        {!isConnected ? (
          <ConnectPrompt />
        ) : onWrongChain ? (
          <WrongChainPrompt />
        ) : isArbiter ? (
          <ArbiterView />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-3 space-y-6">
              <CreateEscrow />
              <EscrowDashboard />
            </div>
            <div className="lg:col-span-2 space-y-6">
              <WithdrawRefund />
              <Reference />
            </div>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}

function ArbiterView() {
  return (
    <div className="space-y-6">
      <section className="card p-5 border-amber-400/20 bg-amber-400/[0.02]">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-amber-400/10 border border-amber-400/20 grid place-items-center shrink-0">
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-amber-300" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l8 4v5c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7l8-4z" />
            </svg>
          </div>
          <div className="text-sm text-slate-300">
            <p className="font-medium text-slate-100">You are connected as the arbiter.</p>
            <p className="text-slate-500 mt-0.5">
              Arbiters cannot create escrows to maintain impartiality. Connect a non-arbiter wallet to create escrows.
            </p>
          </div>
        </div>
      </section>
      <ArbiterPanel />
      <div className="max-w-md">
        <Reference />
      </div>
    </div>
  );
}

function ArbiterHero() {
  return (
    <div className="mb-8">
      <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-amber-400/30 bg-amber-400/[0.05] text-[11px] text-amber-300 mb-4">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
        Arbiter console
      </div>
      <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-slate-100">
        Resolve <span className="bg-gradient-to-r from-amber-300 to-amber-200 bg-clip-text text-transparent">disputed escrows</span>
      </h1>
      <p className="mt-2 text-slate-400 max-w-2xl">
        Review contested escrows and decide whether funds release to the recipient or refund to the depositor.
      </p>
    </div>
  );
}

function Hero() {
  return (
    <div className="mb-10">
      <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-white/10 bg-white/[0.02] text-[11px] text-slate-400 mb-4">
        <span className="h-1.5 w-1.5 rounded-full bg-accent-cyan animate-pulse" />
        Live on Arc Testnet
      </div>
      <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-slate-100">
        Cross-chain <span className="bg-gradient-to-r from-accent-purple to-accent-cyan bg-clip-text text-transparent">USDC escrow</span>
      </h1>
      <p className="mt-2 text-slate-400 max-w-2xl">
        Lock USDC on Arc with a dispute window, then release across chains using Circle's Cross-Chain Transfer Protocol.
      </p>
    </div>
  );
}

function ConnectPrompt() {
  return (
    <div className="card p-10 text-center">
      <div className="mx-auto h-12 w-12 rounded-2xl bg-gradient-to-br from-accent-purple to-accent-cyan grid place-items-center mb-4 shadow-glow">
        <svg viewBox="0 0 24 24" className="h-6 w-6 text-ink-950" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="6" width="20" height="12" rx="2" />
          <path d="M22 12h-6a2 2 0 0 0 0 4h6" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-slate-100">Connect a wallet to continue</h2>
      <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
        Connect MetaMask or any injected wallet to create escrows and manage your on-chain positions.
      </p>
    </div>
  );
}

function WrongChainPrompt() {
  return (
    <div className="card p-10 text-center">
      <h2 className="text-lg font-semibold text-slate-100">Switch to Arc Testnet</h2>
      <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
        This demo only runs on Arc Testnet (chain id {arcTestnet.id}). Use the switch button in the header.
      </p>
    </div>
  );
}

function Reference() {
  return (
    <section className="card p-6">
      <h3 className="text-sm font-semibold text-slate-100 mb-3">Contract</h3>
      <dl className="space-y-2 text-[12px] font-mono">
        <Row label="Address">
          <a
            href={`${EXPLORER_URL}/address/${ESCROW_ADDRESS}`}
            target="_blank"
            rel="noreferrer"
            className="text-accent-cyan hover:underline"
          >
            {shortAddr(ESCROW_ADDRESS)}
          </a>
        </Row>
        <Row label="Chain">
          Arc Testnet · {arcTestnet.id}
        </Row>
        <Row label="RPC">rpc.testnet.arc.network</Row>
      </dl>
      <div className="divider my-4" />
      <p className="text-[11px] text-slate-500 leading-relaxed">
        Testnet demo. Do not use mainnet funds. View source and ABI on the block explorer.
      </p>
    </section>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-300">{children}</dd>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/5 mt-16">
      <div className="mx-auto max-w-6xl px-6 py-6 flex items-center justify-between text-[11px] text-slate-500">
        <span>CrossChainEscrow · Built on Arc</span>
        <a
          href="https://developers.circle.com/cctp"
          target="_blank"
          rel="noreferrer"
          className="hover:text-slate-300"
        >
          CCTP docs ↗
        </a>
      </div>
    </footer>
  );
}
