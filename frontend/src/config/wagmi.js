import { http, createConfig } from 'wagmi';
import { arcTestnet } from 'viem/chains';
import { injected, metaMask } from 'wagmi/connectors';

export const wagmiConfig = createConfig({
  chains: [arcTestnet],
  connectors: [
    injected({ shimDisconnect: true }),
    metaMask({
      dappMetadata: {
        name: 'CrossChainEscrow Demo',
        url: typeof window !== 'undefined' ? window.location.origin : 'https://arc.network',
      },
    }),
  ],
  transports: {
    [arcTestnet.id]: http('https://rpc.testnet.arc.network'),
  },
  ssr: false,
});

export { arcTestnet };
