const AWIN_API_BASE = "https://api.awin.com";
const CLICK_REF_RE = /^[A-Za-z0-9._:-]{1,96}$/;

export function createAwinTransactionClient({
  publisherId,
  accessToken,
  fetchImpl = globalThis.fetch,
  timezone = "Europe/Berlin"
}) {
  if (!/^\d+$/.test(String(publisherId || ""))) throw new TypeError("publisherId is required");
  if (typeof accessToken !== "string" || !accessToken) throw new TypeError("accessToken is required");
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");
  assertTimeZone(timezone);

  return {
    async listTransactions({ startDate, endDate, advertiserIds = [], status = null, dateType = "transaction" }) {
      const start = normalizeDate(startDate);
      const end = normalizeDate(endDate);
      if (end.getTime() < start.getTime()) throw awinTxError("AWIN_TRANSACTION_WINDOW_INVALID", 400);
      if (end.getTime() - start.getTime() > 31 * 24 * 60 * 60 * 1000) {
        throw awinTxError("AWIN_TRANSACTION_WINDOW_EXCEEDS_31_DAYS", 400);
      }

      const url = new URL(`/publishers/${publisherId}/transactions/`, AWIN_API_BASE);
      url.searchParams.set("startDate", apiDate(start, timezone));
      url.searchParams.set("endDate", apiDate(end, timezone));
      url.searchParams.set("timezone", timezone);
      url.searchParams.set("dateType", dateType);
      if (advertiserIds.length > 0) url.searchParams.set("advertiserId", advertiserIds.map(String).join(","));
      if (status) url.searchParams.set("status", status);

      const response = await fetchImpl(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`
        }
      });
      if (!response?.ok) throw awinTxError(`AWIN_TRANSACTIONS_HTTP_${response?.status ?? "UNKNOWN"}`, 502);
      const data = await response.json();
      const rows = Array.isArray(data) ? data : Array.isArray(data?.transactions) ? data.transactions : [];
      return rows.map(normalizeAwinTransaction).filter(Boolean);
    }
  };
}

export function normalizeAwinTransaction(row) {
  if (!row || typeof row !== "object") return null;
  const networkTransactionId = clean(row.id ?? row.transactionId ?? row.transaction_id);
  if (!networkTransactionId) return null;

  const clickRef2 = clean(
    row.clickRef2 ??
    row.clickref2 ??
    row.click_ref2 ??
    row.clickRefs?.clickRef2 ??
    row.clickRefs?.clickref2
  );

  const sale = amountObject(row.saleAmount ?? row.sale_amount, row.currency);
  const commission = amountObject(row.commissionAmount ?? row.commission_amount, sale.currency);

  return {
    network: "AWIN",
    networkTransactionId,
    clickId: CLICK_REF_RE.test(clickRef2) ? clickRef2 : null,
    advertiserId: clean(row.advertiserId ?? row.advertiser_id) || null,
    status: clean(row.status ?? row.commissionStatus ?? row.commission_status) || "UNKNOWN",
    saleAmount: sale.amount,
    saleCurrency: sale.currency,
    commissionAmount: commission.amount,
    commissionCurrency: commission.currency,
    transactionAt: clean(row.transactionDate ?? row.transaction_date ?? row.date) || null,
    validationAt: clean(row.validationDate ?? row.validation_date) || null,
    transactionType: clean(row.type) || null
  };
}

export async function reconcileAwinTransactions({
  client,
  conversionSink,
  startDate,
  endDate,
  advertiserIds = [],
  statuses = [null]
}) {
  if (!client || typeof client.listTransactions !== "function") throw new TypeError("client.listTransactions is required");
  if (!conversionSink || typeof conversionSink.upsert !== "function") throw new TypeError("conversionSink.upsert is required");

  const byKey = new Map();
  for (const status of statuses) {
    const transactions = await client.listTransactions({ startDate, endDate, advertiserIds, status });
    for (const transaction of transactions) {
      byKey.set(`${transaction.network}:${transaction.networkTransactionId}`, transaction);
    }
  }

  for (const transaction of byKey.values()) {
    await conversionSink.upsert(transaction);
  }

  return {
    seen: byKey.size,
    withClickRef: [...byKey.values()].filter((transaction) => Boolean(transaction.clickId)).length
  };
}

function amountObject(value, fallbackCurrency = null) {
  if (value && typeof value === "object") {
    return {
      amount: numericString(value.amount ?? value.value),
      currency: clean(value.currency ?? fallbackCurrency) || null
    };
  }
  return {
    amount: numericString(value),
    currency: clean(fallbackCurrency) || null
  };
}

function numericString(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : null;
}

function normalizeDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw awinTxError("AWIN_TRANSACTION_DATE_INVALID", 400);
  return date;
}

function apiDate(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`;
}

function assertTimeZone(timezone) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date(0));
  } catch {
    throw new TypeError("timezone must be a valid IANA time zone");
  }
}

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function awinTxError(code, status) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}
