export const BIRDIE_MAIL_FOLDER_SEGMENTS = Object.freeze([
  ["Birdie OS"],
  ["Birdie OS", "00 COMMAND CENTER"],
  ["Birdie OS", "00 COMMAND CENTER", "ACTION - TODAY"],
  ["Birdie OS", "00 COMMAND CENTER", "WAITING"],
  ["Birdie OS", "00 COMMAND CENTER", "FOUNDER DECISION"],
  ["Birdie OS", "01 PRODUCTS"],
  ["Birdie OS", "01 PRODUCTS", "Starter Kit"],
  ["Birdie OS", "01 PRODUCTS", "Birdie Booster"],
  ["Birdie OS", "01 PRODUCTS", "Product Operations"],
  ["Birdie OS", "01 PRODUCTS", "Print Data & Artwork"],
  ["Birdie OS", "02 SUPPLIERS"],
  ["Birdie OS", "02 SUPPLIERS", "Offers"],
  ["Birdie OS", "02 SUPPLIERS", "Samples & Prototypes"],
  ["Birdie OS", "02 SUPPLIERS", "Orders"],
  ["Birdie OS", "02 SUPPLIERS", "Production"],
  ["Birdie OS", "02 SUPPLIERS", "Shipping"],
  ["Birdie OS", "03 FINANCE & LEGAL"],
  ["Birdie OS", "03 FINANCE & LEGAL", "Invoices"],
  ["Birdie OS", "03 FINANCE & LEGAL", "Payments"],
  ["Birdie OS", "03 FINANCE & LEGAL", "Banking & Tax"],
  ["Birdie OS", "03 FINANCE & LEGAL", "Contracts & Trademark"],
  ["Birdie OS", "04 MARKETING & SALES"],
  ["Birdie OS", "04 MARKETING & SALES", "Website & Shop"],
  ["Birdie OS", "04 MARKETING & SALES", "Instagram & Meta"],
  ["Birdie OS", "04 MARKETING & SALES", "Klaviyo"],
  ["Birdie OS", "04 MARKETING & SALES", "Sales & Partnerships"],
  ["Birdie OS", "05 COMMUNITY"],
  ["Birdie OS", "05 COMMUNITY", "Supporters"],
  ["Birdie OS", "05 COMMUNITY", "Birdie Coins"],
  ["Birdie OS", "05 COMMUNITY", "Early Bird - Tanja"],
  ["Birdie OS", "05 COMMUNITY", "Crowdfunding"],
  ["Birdie OS", "06 SYSTEMS"],
  ["Birdie OS", "06 SYSTEMS", "Birdie OS"],
  ["Birdie OS", "06 SYSTEMS", "Google & Search Console"],
  ["Birdie OS", "06 SYSTEMS", "Accounts & Security"],
  ["Birdie OS", "06 SYSTEMS", "Automatic System Messages"],
  ["Birdie OS", "90 REFERENCE"],
  ["Birdie OS", "99 ARCHIVE"],
  ["Birdie OS", "99 NEWSLETTERS"]
]);

export function buildBirdieFolderPaths(delimiter = "/") {
  const safeDelimiter = typeof delimiter === "string" && delimiter ? delimiter : "/";
  return BIRDIE_MAIL_FOLDER_SEGMENTS.map((segments) => segments.join(safeDelimiter));
}

export function httpError(code, status, message = code) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

export function requireFounderApproval(body, confirmation) {
  if (body?.founderApproved !== true || body?.confirmation !== confirmation) {
    throw httpError(
      "FOUNDER_APPROVAL_REQUIRED",
      403,
      `founderApproved=true and confirmation=${confirmation} are required`
    );
  }
}

export function normalizeUid(value) {
  const uid = Number(value);
  if (!Number.isSafeInteger(uid) || uid < 1) {
    throw httpError("INVALID_UID", 400, "uid must be a positive integer");
  }
  return uid;
}

export function normalizeMailbox(value = "INBOX") {
  const mailbox = String(value || "INBOX").trim();
  if (!mailbox || mailbox.length > 240 || /[\r\n\0]/.test(mailbox)) {
    throw httpError("INVALID_MAILBOX", 400, "mailbox is invalid");
  }
  return mailbox;
}
