import React from 'react';
import ReactDOM from 'react-dom/client';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import emailjs from '@emailjs/browser';
import App from './App';
import { wagmiConfig } from './config/wagmi';
import { EMAILJS_PUBLIC_KEY, emailjsConfigured } from './config/emailjs';
import './index.css';

if (emailjsConfigured()) {
  emailjs.init(EMAILJS_PUBLIC_KEY);
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <App />
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: '#11141d',
              color: '#e2e8f0',
              border: '1px solid rgba(255,255,255,0.08)',
              fontSize: '13px',
              fontFamily: 'Inter, ui-sans-serif',
              maxWidth: 420,
            },
            success: { iconTheme: { primary: '#22d3ee', secondary: '#0b0d14' } },
            error: { iconTheme: { primary: '#f87171', secondary: '#0b0d14' } },
          }}
        />
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
);
