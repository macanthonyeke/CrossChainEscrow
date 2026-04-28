import emailjs from '@emailjs/browser';
import { formatUnits } from 'viem';
import {
  EMAILJS_SERVICE_ID,
  EMAILJS_TEMPLATE_ID,
  emailjsConfigured,
} from '../config/emailjs';
import { ARBITER_EMAIL } from '../config/contracts';

function emailKey(address) {
  return address ? `escrow_email_${address.toLowerCase()}` : '';
}

export function getEmailForWallet(address) {
  if (!address || typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(emailKey(address));
  } catch {
    return null;
  }
}

export function setEmailForWallet(address, email) {
  if (!address || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(emailKey(address), email);
    window.dispatchEvent(new Event('cce:notifications-changed'));
  } catch {
    // ignore quota / privacy errors — notifications are best-effort
  }
}

export function removeEmailForWallet(address) {
  if (!address || typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(emailKey(address));
    window.dispatchEvent(new Event('cce:notifications-changed'));
  } catch {
    // ignore
  }
}

const SKIP_KEY = 'cce:notifications:skipped';

export function getSkipped(address) {
  if (!address || typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(SKIP_KEY);
    const map = raw ? JSON.parse(raw) : {};
    return Boolean(map[key(address)]);
  } catch {
    return false;
  }
}

export function setSkipped(address, value) {
  if (!address || typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(SKIP_KEY);
    const map = raw ? JSON.parse(raw) : {};
    if (value) map[key(address)] = true;
    else delete map[key(address)];
    window.localStorage.setItem(SKIP_KEY, JSON.stringify(map));
    window.dispatchEvent(new Event('cce:notifications-changed'));
  } catch {
    // ignore
  }
}

function fmtUsdc(amount) {
  try {
    return Number(formatUnits(amount, 6)).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return String(amount);
  }
}

function fmtWindow(seconds) {
  if (!seconds || seconds <= 0) return 'unknown';
  const h = Math.round(seconds / 3600);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'}`;
}

async function sendNotification({
  eventType,
  toEmail,
  role,
  escrowId,
  subject,
  status,
  actionMessage,
  amount,
  destination,
  depositor,
  recipient,
  disputeWindow,
}) {
  if (!toEmail) {
    const reason =
      role === 'recipient'
        ? `No email on file for recipient of escrow #${escrowId}. ` +
          `This is expected if the recipient has not connected their wallet and saved an email from this browser yet. ` +
          `Skipping recipient notification for event "${eventType}".`
        : `No email on file for ${role} of escrow #${escrowId}. ` +
          `Skipping ${role} notification for event "${eventType}".`;
    console.warn(`[notifications] ${reason}`);
    return;
  }

  const params = {
    to_email: toEmail,
    subject,
    status,
    action_message: actionMessage,
    amount,
    destination,
    depositor,
    recipient,
    dispute_window: disputeWindow,
  };

  console.log('[notifications] emailjs.send', {
    event: eventType,
    role,
    to_email: toEmail,
    escrowId,
  });

  if (!emailjsConfigured()) {
    console.info(
      `[notifications] EmailJS not configured — would have sent to ${role} (${toEmail})`,
      params,
    );
    return;
  }

  try {
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, params);
    console.info(`[notifications] Sent to ${role} (${toEmail})`);
  } catch (err) {
    console.warn(
      `[notifications] Send failed for ${role} (${toEmail}) on escrow #${escrowId}`,
      err,
    );
  }
}

function buildCommon({
  escrowId,
  depositor,
  recipient,
  amount,
  destinationChain,
  disputeWindowSeconds,
}) {
  const depositorEmail = getEmailForWallet(depositor);
  const recipientEmail = getEmailForWallet(recipient);

  console.info(`[notifications] Lookup for escrow #${escrowId}:`, {
    depositor,
    depositorEmail: depositorEmail ?? '(none on this device)',
    recipient,
    recipientEmail: recipientEmail ?? '(none on this device)',
    arbiter: ARBITER_EMAIL,
  });

  return {
    depositorEmail,
    recipientEmail,
    arbiterEmail: ARBITER_EMAIL,
    amountStr: fmtUsdc(amount),
    destination: destinationChain ?? 'unknown',
    disputeWindowStr: fmtWindow(disputeWindowSeconds),
    escrowId,
    depositor,
    recipient,
  };
}

export async function notifyDepositCreated(args) {
  const c = buildCommon(args);
  const id = `#${c.escrowId ?? ''}`.trim();

  await sendNotification({
    eventType: 'DepositCreated',
    toEmail: c.depositorEmail,
    role: 'depositor',
    escrowId: c.escrowId,
    subject: `Escrow ${id} — Created`,
    status: 'DEPOSITED',
    actionMessage: `Your escrow has been created and funded with ${c.amountStr} USDC. The funds are locked and waiting for you to fulfill the condition. Once the agreed terms are met, return to the app and click Fulfill Condition to start the dispute window.`,
    amount: c.amountStr,
    destination: c.destination,
    depositor: c.depositor,
    recipient: c.recipient,
    disputeWindow: c.disputeWindowStr,
  });

  await sendNotification({
    eventType: 'DepositCreated',
    toEmail: c.recipientEmail,
    role: 'recipient',
    escrowId: c.escrowId,
    subject: `Escrow ${id} — You're the Recipient`,
    status: 'DEPOSITED',
    actionMessage: `You've been added as the recipient on a new escrow for ${c.amountStr} USDC. The depositor will fulfill the condition once the agreed terms are met. You'll be notified when that happens and the dispute window opens.`,
    amount: c.amountStr,
    destination: c.destination,
    depositor: c.depositor,
    recipient: c.recipient,
    disputeWindow: c.disputeWindowStr,
  });
}

export async function notifyConditionFulfilled(args) {
  const c = buildCommon(args);
  const id = `#${c.escrowId}`;

  await sendNotification({
    eventType: 'ConditionFulfilled',
    toEmail: c.depositorEmail,
    role: 'depositor',
    escrowId: c.escrowId,
    subject: `Escrow ${id} — Condition Fulfilled`,
    status: 'CONDITION_MET',
    actionMessage: `You've confirmed the condition is met. The dispute window is now open for ${c.disputeWindowStr}. If neither party raises a dispute during this time, the funds will be released automatically to the recipient on ${c.destination} via CCTP.`,
    amount: c.amountStr,
    destination: c.destination,
    depositor: c.depositor,
    recipient: c.recipient,
    disputeWindow: c.disputeWindowStr,
  });

  await sendNotification({
    eventType: 'ConditionFulfilled',
    toEmail: c.recipientEmail,
    role: 'recipient',
    escrowId: c.escrowId,
    subject: `Escrow ${id} — Condition Fulfilled`,
    status: 'CONDITION_MET',
    actionMessage: `The depositor has confirmed the condition is met on your escrow. The dispute window is now open for ${c.disputeWindowStr}. If you believe something is wrong, raise a dispute before the window closes. If no dispute is raised, ${c.amountStr} USDC will be released to you on ${c.destination}.`,
    amount: c.amountStr,
    destination: c.destination,
    depositor: c.depositor,
    recipient: c.recipient,
    disputeWindow: c.disputeWindowStr,
  });
}

export async function notifyDisputeRaised(args) {
  const c = buildCommon(args);
  const id = `#${c.escrowId}`;

  await sendNotification({
    eventType: 'DisputeRaised',
    toEmail: c.depositorEmail,
    role: 'depositor',
    escrowId: c.escrowId,
    subject: `Escrow ${id} — Dispute Raised`,
    status: 'DISPUTED',
    actionMessage: `A dispute has been raised on your escrow. The arbiter will review the situation and either release the funds to the recipient or refund them to your refund address. You'll be notified once the arbiter makes a decision.`,
    amount: c.amountStr,
    destination: c.destination,
    depositor: c.depositor,
    recipient: c.recipient,
    disputeWindow: c.disputeWindowStr,
  });

  await sendNotification({
    eventType: 'DisputeRaised',
    toEmail: c.recipientEmail,
    role: 'recipient',
    escrowId: c.escrowId,
    subject: `Escrow ${id} — Dispute Raised`,
    status: 'DISPUTED',
    actionMessage: `A dispute has been raised on your escrow. The arbiter will review the situation and either release the funds to you or refund them to the depositor. You'll be notified once the arbiter makes a decision.`,
    amount: c.amountStr,
    destination: c.destination,
    depositor: c.depositor,
    recipient: c.recipient,
    disputeWindow: c.disputeWindowStr,
  });

  await sendNotification({
    eventType: 'DisputeRaised',
    toEmail: c.arbiterEmail,
    role: 'arbiter',
    escrowId: c.escrowId,
    subject: `Escrow ${id} — ACTION REQUIRED: Dispute Raised`,
    status: 'DISPUTED',
    actionMessage: `A dispute has been raised and requires your review. Please connect your arbiter wallet to the app, review the escrow details, and resolve by either releasing the funds to the recipient via CCTP or refunding to the depositor.`,
    amount: c.amountStr,
    destination: c.destination,
    depositor: c.depositor,
    recipient: c.recipient,
    disputeWindow: c.disputeWindowStr,
  });
}

export async function notifyDisputeResolved(args) {
  const { releasedToRecipient } = args;
  const c = buildCommon(args);
  const id = `#${c.escrowId}`;

  if (releasedToRecipient) {
    await sendNotification({
      eventType: 'DisputeResolved:Released',
      toEmail: c.depositorEmail,
      role: 'depositor',
      escrowId: c.escrowId,
      subject: `Escrow ${id} — Resolved: Released`,
      status: 'RELEASED',
      actionMessage: `The arbiter has reviewed the dispute and released ${c.amountStr} USDC to the recipient on ${c.destination} via CCTP. This escrow is now closed.`,
      amount: c.amountStr,
      destination: c.destination,
      depositor: c.depositor,
      recipient: c.recipient,
      disputeWindow: c.disputeWindowStr,
    });

    await sendNotification({
      eventType: 'DisputeResolved:Released',
      toEmail: c.recipientEmail,
      role: 'recipient',
      escrowId: c.escrowId,
      subject: `Escrow ${id} — Resolved in Your Favor`,
      status: 'RELEASED',
      actionMessage: `The arbiter has resolved the dispute in your favor. ${c.amountStr} USDC has been released to you on ${c.destination} via CCTP. This escrow is now closed.`,
      amount: c.amountStr,
      destination: c.destination,
      depositor: c.depositor,
      recipient: c.recipient,
      disputeWindow: c.disputeWindowStr,
    });

    await sendNotification({
      eventType: 'DisputeResolved:Released',
      toEmail: c.arbiterEmail,
      role: 'arbiter',
      escrowId: c.escrowId,
      subject: `Escrow ${id} — Resolution Confirmed: Released`,
      status: 'RELEASED',
      actionMessage: `You resolved Escrow ${id} by releasing ${c.amountStr} USDC to the recipient on ${c.destination} via CCTP.`,
      amount: c.amountStr,
      destination: c.destination,
      depositor: c.depositor,
      recipient: c.recipient,
      disputeWindow: c.disputeWindowStr,
    });
  } else {
    await sendNotification({
      eventType: 'DisputeResolved:Refunded',
      toEmail: c.depositorEmail,
      role: 'depositor',
      escrowId: c.escrowId,
      subject: `Escrow ${id} — Resolved: Refunded`,
      status: 'REFUNDED',
      actionMessage: `The arbiter has reviewed the dispute and refunded ${c.amountStr} USDC to your refund address. Go to the Refund Balance section in the app to withdraw your funds.`,
      amount: c.amountStr,
      destination: c.destination,
      depositor: c.depositor,
      recipient: c.recipient,
      disputeWindow: c.disputeWindowStr,
    });

    await sendNotification({
      eventType: 'DisputeResolved:Refunded',
      toEmail: c.recipientEmail,
      role: 'recipient',
      escrowId: c.escrowId,
      subject: `Escrow ${id} — Resolved: Refunded`,
      status: 'REFUNDED',
      actionMessage: `The arbiter has reviewed the dispute and refunded the funds to the depositor. This escrow is now closed.`,
      amount: c.amountStr,
      destination: c.destination,
      depositor: c.depositor,
      recipient: c.recipient,
      disputeWindow: c.disputeWindowStr,
    });

    await sendNotification({
      eventType: 'DisputeResolved:Refunded',
      toEmail: c.arbiterEmail,
      role: 'arbiter',
      escrowId: c.escrowId,
      subject: `Escrow ${id} — Resolution Confirmed: Refunded`,
      status: 'REFUNDED',
      actionMessage: `You resolved Escrow ${id} by refunding ${c.amountStr} USDC to the depositor's refund address.`,
      amount: c.amountStr,
      destination: c.destination,
      depositor: c.depositor,
      recipient: c.recipient,
      disputeWindow: c.disputeWindowStr,
    });
  }
}

export async function notifyReleasedAfterWindow(args) {
  const c = buildCommon(args);
  const id = `#${c.escrowId}`;

  await sendNotification({
    eventType: 'ReleasedAfterWindow',
    toEmail: c.depositorEmail,
    role: 'depositor',
    escrowId: c.escrowId,
    subject: `Escrow ${id} — Released`,
    status: 'RELEASED',
    actionMessage: `The dispute window has passed with no disputes raised. ${c.amountStr} USDC has been burned on Arc and will be minted on ${c.destination} via CCTP. This escrow is now closed.`,
    amount: c.amountStr,
    destination: c.destination,
    depositor: c.depositor,
    recipient: c.recipient,
    disputeWindow: c.disputeWindowStr,
  });

  await sendNotification({
    eventType: 'ReleasedAfterWindow',
    toEmail: c.recipientEmail,
    role: 'recipient',
    escrowId: c.escrowId,
    subject: `Escrow ${id} — Funds Released to You`,
    status: 'RELEASED',
    actionMessage: `The dispute window has passed with no disputes. ${c.amountStr} USDC has been released and will arrive on ${c.destination} via CCTP. This escrow is now closed.`,
    amount: c.amountStr,
    destination: c.destination,
    depositor: c.depositor,
    recipient: c.recipient,
    disputeWindow: c.disputeWindowStr,
  });
}

export async function notifyMutualCancel(args) {
  const c = buildCommon(args);
  const id = `#${c.escrowId}`;

  await sendNotification({
    eventType: 'MutualCancel',
    toEmail: c.depositorEmail,
    role: 'depositor',
    escrowId: c.escrowId,
    subject: `Escrow ${id} — Cancelled`,
    status: 'REFUNDED',
    actionMessage: `Both parties agreed to cancel this escrow. ${c.amountStr} USDC has been credited to your refund balance. Go to the Refund Balance section in the app to withdraw.`,
    amount: c.amountStr,
    destination: c.destination,
    depositor: c.depositor,
    recipient: c.recipient,
    disputeWindow: c.disputeWindowStr,
  });

  await sendNotification({
    eventType: 'MutualCancel',
    toEmail: c.recipientEmail,
    role: 'recipient',
    escrowId: c.escrowId,
    subject: `Escrow ${id} — Cancelled`,
    status: 'REFUNDED',
    actionMessage: `Both parties agreed to cancel this escrow. The funds have been returned to the depositor's refund balance. This escrow is now closed.`,
    amount: c.amountStr,
    destination: c.destination,
    depositor: c.depositor,
    recipient: c.recipient,
    disputeWindow: c.disputeWindowStr,
  });
}
