/** Open a transaction detail from anywhere (e.g. the notification inbox). LivePlaidDashboard listens. */
export const OPEN_TRANSACTION_EVENT = "sentryfi:open-transaction";
export const openTransaction = (txnId: string) =>
  window.dispatchEvent(new CustomEvent<{ txnId: string }>(OPEN_TRANSACTION_EVENT, { detail: { txnId } }));
