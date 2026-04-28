// EmailJS configuration — fill in with your own values from https://www.emailjs.com
// Install: `npm install @emailjs/browser`
//
// The EmailJS template must accept these variables:
//   {{to_email}}         — destination email
//   {{subject}}          — email subject
//   {{status}}           — current escrow state in caps
//   {{action_message}}   — human-readable body explaining what happened
//   {{amount}}           — USDC amount formatted with 2 decimal places
//   {{destination}}      — destination chain name
//   {{depositor}}        — depositor wallet address
//   {{recipient}}        — recipient wallet address
//   {{dispute_window}}   — dispute window duration (e.g. "24 hours")

export const EMAILJS_SERVICE_ID = 'service_7tqmxwd';
export const EMAILJS_TEMPLATE_ID = 'template_ovi3puf';
export const EMAILJS_PUBLIC_KEY = 'iefLNYmPcYZjCiTYj';

export function emailjsConfigured() {
  return (
    EMAILJS_SERVICE_ID &&
    !EMAILJS_SERVICE_ID.startsWith('YOUR_') &&
    EMAILJS_TEMPLATE_ID &&
    !EMAILJS_TEMPLATE_ID.startsWith('YOUR_') &&
    EMAILJS_PUBLIC_KEY &&
    !EMAILJS_PUBLIC_KEY.startsWith('YOUR_')
  );
}
